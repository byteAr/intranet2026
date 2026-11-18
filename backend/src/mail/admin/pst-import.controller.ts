import {
  Controller,
  Post,
  Get,
  Param,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  NotFoundException,
  HttpCode,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { Roles } from '../../auth/decorators/roles.decorator';
import { PstImportService } from './pst-import.service';
import { checkPstFile, formatBytes } from './pst-file-check.util';

const uploadDir = () => process.env['MAIL_PST_UPLOAD_PATH'] ?? '/app/storage/pst';

/** Nombre con el que queda en el servidor (el mismo que veía la lista hasta ahora). */
const finalName = (original: string) => {
  const ext = path.extname(original);
  return `${path.basename(original, ext).replace(/[^a-zA-Z0-9._-]/g, '_')}${ext}`;
};

/**
 * Mientras se sube, el archivo se llama `<nombre>.pst.part-<hora>`: la lista solo
 * muestra los `.pst`, así que una subida cortada nunca aparece como un PST para
 * importar (antes quedaba con el nombre final: 2019.pst, 18/11/2026). Las que se
 * cortaron se borran solas cuando llevan 15 min sin crecer.
 */
const PART_RE = /\.part-\d+$/;
const STALE_PART_MS = 15 * 60_000;

@Controller('mail/admin/pst')
@Roles('TICOM')
export class PstImportController {
  constructor(private readonly pstImportService: PstImportService) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const uploadPath = uploadDir();
          if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });
          cb(null, uploadPath);
        },
        filename: (_req, file, cb) => {
          cb(null, `${finalName(file.originalname)}.part-${Date.now()}`);
        },
      }),
      limits: { fileSize: 15 * 1024 * 1024 * 1024 }, // 15 GB
      fileFilter: (_req, file, cb) => {
        if (file.originalname.toLowerCase().endsWith('.pst')) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Solo se permiten archivos .pst'), false);
        }
      },
    }),
  )
  async upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No se recibió ningún archivo');
    const name = finalName(file.originalname);
    let check;
    try {
      check = checkPstFile(file.path);
    } catch (err) {
      fs.rmSync(file.path, { force: true });
      throw err;
    }
    if (check.problem) {
      fs.rmSync(file.path, { force: true });
      // Llegó todo lo que mandó el navegador: el archivo ya estaba así en la PC.
      throw new BadRequestException(
        check.expectedSize
          ? `${name} está cortado: el PST dice pesar ${formatBytes(check.expectedSize)} y tiene ${formatBytes(check.actualSize)}. ` +
            'Ya estaba así en la PC: buscá el archivo original o exportalo de nuevo desde Outlook.'
          : `${name}: ${check.problem}.`,
      );
    }
    // Recién ahora reemplaza al anterior con el mismo nombre (si lo había).
    fs.renameSync(file.path, path.join(path.dirname(file.path), name));
    return { filename: name, size: file.size };
  }

  @Post('import/:filename')
  async startImport(
    @Param('filename') filename: string,
    @CurrentUser() user: { displayName: string },
  ) {
    if (filename.includes('/') || filename.includes('..')) {
      throw new BadRequestException('Nombre de archivo inválido');
    }
    const { alreadyImported } = await this.pstImportService.startImport(filename, user.displayName);
    if (alreadyImported) {
      return { ok: true, alreadyImported, message: `${filename} ya se importó completo: lo que trae ya está en la intranet.` };
    }
    return { ok: true, alreadyImported, message: 'Importación iniciada en segundo plano' };
  }

  @Get('history')
  async getHistory() {
    return this.pstImportService.getHistory();
  }

  @Post('reprocess-references')
  @HttpCode(200)
  async reprocessReferences() {
    return this.pstImportService.reprocessReferences();
  }

  @Get('reprocess-status')
  async reprocessStatus() {
    return this.pstImportService.getReprocessStatus();
  }

  @Get('files')
  listFiles() {
    const uploadPath = uploadDir();
    if (!fs.existsSync(uploadPath)) return { files: [] };
    const names = fs.readdirSync(uploadPath);
    for (const f of names.filter((n) => PART_RE.test(n))) {
      try {
        const full = path.join(uploadPath, f);
        if (Date.now() - fs.statSync(full).mtimeMs > STALE_PART_MS) fs.rmSync(full, { force: true });
      } catch { /* ya no está */ }
    }
    const files = names
      .filter((f) => f.toLowerCase().endsWith('.pst'))
      .map((f) => {
        const full = path.join(uploadPath, f);
        const stat = fs.statSync(full);
        let problem: string | null = null;
        try { problem = checkPstFile(full).problem; } catch { problem = 'No se puede leer'; }
        return { filename: f, size: stat.size, modifiedAt: stat.mtime, problem };
      })
      .sort((a, b) => a.filename.localeCompare(b.filename));
    return { files };
  }
}

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
  HttpException,
  Injectable,
  CanActivate,
  ExecutionContext,
  UseGuards,
  Delete,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { Roles } from '../../auth/decorators/roles.decorator';
import { PstImportService } from './pst-import.service';
import { checkPstFile, formatBytes } from './pst-file-check.util';
import { DISK_UPLOAD_MARGIN_BYTES, diskSpace } from '../../common/disk-space.util';

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

/**
 * Antes de recibir un byte: si el archivo no entra en el disco (dejando el
 * margen), se rechaza con el motivo. Con el disco lleno la subida se cortaba
 * a mitad y la pantalla decía solo "Error al subir el archivo" (19/11/2026).
 * La pantalla además lo consulta antes de empezar (`GET space`).
 */
@Injectable()
class PstUploadSpaceGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
    const length = Number(req.headers['content-length'] ?? 0);
    const disk = await diskSpace(uploadDir());
    if (disk && length > disk.uploadMaxBytes) {
      throw new HttpException(noSpaceMessage(length, disk.freeBytes), 507);
    }
    return true;
  }
}

function noSpaceMessage(size: number, free: number): string {
  return `No hay lugar en el servidor: el archivo pesa ${formatBytes(size)} y quedan ${formatBytes(free)} libres ` +
    `(siempre se dejan ${formatBytes(DISK_UPLOAD_MARGIN_BYTES)} para la base). ` +
    'Borrá de la lista los PST ya importados para liberar espacio.';
}

@Controller('mail/admin/pst')
@Roles('TICOM')
export class PstImportController {
  constructor(private readonly pstImportService: PstImportService) {}

  @Post('upload')
  @UseGuards(PstUploadSpaceGuard)
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

  /** Lugar para subir: la pantalla lo consulta antes de empezar y lo muestra. */
  @Get('space')
  async space() {
    return (await diskSpace(uploadDir())) ?? { unknown: true };
  }

  /**
   * Borra un PST del servidor. Lo importado queda en la intranet (base y
   * adjuntos) y el historial lo sigue mostrando; el archivo ocupaba lugar al
   * cuete (84 GB el 19/11/2026). No se puede mientras se está importando.
   */
  @Delete('files/:filename')
  async deleteFile(@Param('filename') filename: string) {
    if (filename.includes('/') || filename.includes('..') || !filename.toLowerCase().endsWith('.pst')) {
      throw new BadRequestException('Nombre de archivo inválido');
    }
    await this.pstImportService.deleteFile(filename);
    return { ok: true };
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

import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { Roles } from '../../auth/decorators/roles.decorator';
import { PstImportService } from './pst-import.service';

@Controller('mail/admin/pst')
@Roles('TICOM')
export class PstImportController {
  constructor(private readonly pstImportService: PstImportService) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const uploadPath = process.env['MAIL_PST_UPLOAD_PATH'] ?? '/app/storage/pst';
          if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });
          cb(null, uploadPath);
        },
        filename: (_req, file, cb) => {
          const ext = path.extname(file.originalname);
          const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9._-]/g, '_');
          cb(null, `${base}${ext}`);
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
    return { filename: file.filename, size: file.size };
  }

  @Post('import/:filename')
  async startImport(@Param('filename') filename: string) {
    if (filename.includes('/') || filename.includes('..')) {
      throw new BadRequestException('Nombre de archivo inválido');
    }
    await this.pstImportService.startImport(filename);
    return { ok: true, message: 'Importación iniciada en segundo plano' };
  }

  @Get('history')
  async getHistory() {
    return this.pstImportService.getHistory();
  }

  @Delete('history')
  async clearHistory() {
    await this.pstImportService.clearHistory();
    return { ok: true };
  }

  @Get('files')
  listFiles() {
    const uploadPath = process.env['MAIL_PST_UPLOAD_PATH'] ?? '/app/storage/pst';
    if (!fs.existsSync(uploadPath)) return { files: [] };
    const files = fs.readdirSync(uploadPath)
      .filter((f) => f.toLowerCase().endsWith('.pst'))
      .map((f) => {
        const stat = fs.statSync(path.join(uploadPath, f));
        return { filename: f, size: stat.size, modifiedAt: stat.mtime };
      })
      .sort((a, b) => a.filename.localeCompare(b.filename));
    return { files };
  }
}

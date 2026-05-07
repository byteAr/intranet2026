import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  Req,
  Body,
  Res,
  UseInterceptors,
  UploadedFile,
  UseGuards,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join, basename } from 'path';
import { existsSync, mkdirSync, createReadStream, unlinkSync } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { tmpdir } from 'os';
import { Response } from 'express';
import { randomUUID } from 'crypto';

const execFileAsync = promisify(execFile);

function guessMime(filename: string): string {
  const ext = extname(filename).toLowerCase();
  const map: Record<string, string> = {
    '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
    '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
  return map[ext] ?? 'application/octet-stream';
}
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../auth/decorators/public.decorator';
import { ChatService } from './chat.service';
import { BroadcastDmService } from './broadcast-dm.service';
import { ChatGateway } from './chat.gateway';
import { UsersService } from '../users/users.service';

const UPLOAD_DIR = '/app/uploads/chat';

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.ms-excel',
]);

@Controller('chat')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly broadcastDmService: BroadcastDmService,
    private readonly chatGateway: ChatGateway,
    private readonly usersService: UsersService,
  ) {}

  @Post('broadcast-dm')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });
          cb(null, UPLOAD_DIR);
        },
        filename: (_req, file, cb) => {
          const ext = extname(file.originalname);
          cb(null, `${crypto.randomUUID()}${ext}`);
        },
      }),
      limits: { fileSize: 50 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        ALLOWED_TYPES.has(file.mimetype) ? cb(null, true) : cb(new BadRequestException('Tipo de archivo no permitido'), false);
      },
    }),
  )
  async broadcastDm(
    @Req() req: any,
    @Body('content') content: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (req.user.username !== 'mlopez') throw new ForbiddenException('Sin permiso');
    if (!content?.trim() && !file) throw new BadRequestException('Se requiere contenido o archivo');

    // 1. Guardar el broadcast en DB — garantiza entrega a futuros usuarios
    await this.broadcastDmService.create({
      senderId: req.user.id,
      senderName: req.user.displayName ?? req.user.username,
      senderAvatar: this.chatGateway.getSenderAvatar(req.user.id),
      content: content?.trim() ?? '',
      attachmentUrl: file ? `/api/chat/files/${file.filename}` : undefined,
      attachmentName: file?.originalname,
      attachmentSize: file?.size,
      attachmentMimeType: file?.mimetype,
    });

    // 2. Entregar inmediatamente a todos los usuarios ya en DB
    const recipients = await this.usersService.findAllActiveIds(req.user.id);
    for (const { id: recipientId } of recipients) {
      await this.broadcastDmService.deliverPendingToUser(recipientId, this.chatService, (msg) => {
        this.chatGateway.emitDmToUser(recipientId, msg);
        this.chatGateway.emitDmToUser(req.user.id, msg);
      });
    }

    return { ok: true, sent: recipients.length };
  }

  @Post('upload')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });
          cb(null, UPLOAD_DIR);
        },
        filename: (_req, file, cb) => {
          const ext = extname(file.originalname);
          cb(null, `${crypto.randomUUID()}${ext}`);
        },
      }),
      limits: { fileSize: 50 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_TYPES.has(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Tipo de archivo no permitido'), false);
        }
      },
    }),
  )
  uploadFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No se recibió ningún archivo');
    return {
      url: `/api/chat/files/${file.filename}`,
      name: file.originalname,
      size: file.size,
      mimeType: file.mimetype,
    };
  }

  @Get('files/:filename/preview')
  @Public()
  async previewFile(
    @Param('filename') filename: string,
    @Query('name') name: string,
    @Res() res: Response,
  ) {
    if (filename.includes('/') || filename.includes('..')) {
      throw new BadRequestException('Nombre de archivo inválido');
    }
    const filePath = join(UPLOAD_DIR, filename);
    if (!existsSync(filePath)) throw new NotFoundException('Archivo no encontrado');

    const realName = name && !name.includes('/') && !name.includes('..') ? name : filename;
    const mime = guessMime(realName);
    const isPdf = mime === 'application/pdf';
    const isImage = mime.startsWith('image/');

    if (isPdf || isImage) {
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Disposition', `inline; filename="${realName}"`);
      createReadStream(filePath).pipe(res);
      return;
    }

    const outDir = join(tmpdir(), `preview-${randomUUID()}`);
    mkdirSync(outDir, { recursive: true });
    try {
      await execFileAsync('libreoffice', [
        '--headless', '--convert-to', 'pdf',
        '--outdir', outDir,
        filePath,
      ], { timeout: 30000 });

      const pdfName = basename(filePath).replace(/\.[^.]+$/, '.pdf');
      const pdfPath = join(outDir, pdfName);

      if (!existsSync(pdfPath)) {
        res.status(500).json({ message: 'Error al generar vista previa' });
        return;
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${realName}.pdf"`);
      const stream = createReadStream(pdfPath);
      stream.on('end', () => {
        try { unlinkSync(pdfPath); } catch {}
        try { require('fs').rmdirSync(outDir); } catch {}
      });
      stream.pipe(res);
    } catch {
      try { require('fs').rmSync(outDir, { recursive: true, force: true }); } catch {}
      res.status(500).json({ message: 'Error al generar vista previa del documento' });
    }
  }

  @Get('files/:filename')
  @Public()
  downloadFile(
    @Param('filename') filename: string,
    @Query('name') name: string,
    @Res() res: Response,
  ) {
    if (filename.includes('/') || filename.includes('..')) {
      throw new BadRequestException('Nombre de archivo inválido');
    }
    const filePath = join(UPLOAD_DIR, filename);
    if (!existsSync(filePath)) throw new NotFoundException('Archivo no encontrado');
    const downloadName = name && !name.includes('/') && !name.includes('..') ? name : filename;
    res.download(filePath, downloadName);
  }
}

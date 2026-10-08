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
import { extname, join } from 'path';
import { existsSync, mkdirSync, createReadStream } from 'fs';
import { Response } from 'express';
import { randomUUID } from 'crypto';

function guessMime(filename: string): string {
  const ext = extname(filename).toLowerCase();
  const map: Record<string, string> = {
    '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
    '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.txt': 'text/plain; charset=utf-8', '.rar': 'application/vnd.rar',
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
  'text/plain',
  'application/vnd.rar',
  'application/x-rar-compressed',
  'application/x-rar',
]);

/**
 * Se aceptan también por la extensión: Chrome en Windows suele mandar los .rar
 * sin tipo (o como application/octet-stream).
 */
const ALLOWED_BY_EXTENSION: Record<string, string> = {
  '.txt': 'text/plain',
  '.rar': 'application/vnd.rar',
};

type ChatFileInfo = Pick<Express.Multer.File, 'mimetype' | 'originalname'>;

function isAllowedChatFile(file: ChatFileInfo): boolean {
  return ALLOWED_TYPES.has(file.mimetype) || extname(file.originalname).toLowerCase() in ALLOWED_BY_EXTENSION;
}

/** El tipo con el que se guarda: el de la extensión para .txt / .rar (el navegador a veces no lo manda). */
function chatMimeOf(file: ChatFileInfo): string {
  return ALLOWED_BY_EXTENSION[extname(file.originalname).toLowerCase()] ?? file.mimetype;
}

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
        isAllowedChatFile(file) ? cb(null, true) : cb(new BadRequestException('Tipo de archivo no permitido'), false);
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
      attachmentMimeType: file ? chatMimeOf(file) : undefined,
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
        if (isAllowedChatFile(file)) {
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
      // multer entrega el nombre en latin1: así se conservan las tildes
      name: Buffer.from(file.originalname, 'latin1').toString('utf8'),
      size: file.size,
      mimeType: chatMimeOf(file),
    };
  }

  @Get('files/:filename/preview')
  @Public()
  async previewFile(
    @Param('filename') filename: string,
    @Query('name') name: string,
    @Res() res: Response,
  ) {
    try {
      if (filename.includes('/') || filename.includes('..')) {
        res.status(400).json({ message: 'Nombre de archivo inválido' });
        return;
      }
      const filePath = join(UPLOAD_DIR, filename);
      if (!existsSync(filePath)) {
        res.status(404).json({ message: 'Archivo no encontrado' });
        return;
      }

      const realName = name && !name.includes('/') && !name.includes('..') ? name : filename;
      const mime = guessMime(realName);
      res.setHeader('Content-Type', mime);
      // Que el navegador no adivine otro tipo (un .txt nunca se interpreta como HTML).
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', `inline; filename="${realName}"`);
      createReadStream(filePath).pipe(res);
    } catch (err) {
      console.error(`[chat-preview] Error:`, err);
      if (!res.headersSent) {
        res.status(500).json({ message: 'Error al obtener archivo' });
      }
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

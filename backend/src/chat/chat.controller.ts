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
import { existsSync, mkdirSync } from 'fs';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../auth/decorators/public.decorator';
import { ChatService } from './chat.service';
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

    const recipients = await this.usersService.findAllActiveIds(req.user.id);
    const senderAvatar = this.chatGateway.getSenderAvatar(req.user.id);

    const attachmentUrl = file ? `/api/chat/files/${file.filename}` : undefined;
    const attachmentName = file?.originalname;
    const attachmentSize = file?.size;
    const attachmentMimeType = file?.mimetype;

    for (const { id: recipientId } of recipients) {
      const msg = await this.chatService.saveMessage({
        senderId: req.user.id,
        senderName: req.user.displayName ?? req.user.username,
        senderAvatar,
        recipientId,
        content: content?.trim() ?? '',
        attachmentUrl,
        attachmentName,
        attachmentSize,
        attachmentMimeType,
      });
      this.chatGateway.emitDmToUser(recipientId, msg);
      this.chatGateway.emitDmToUser(req.user.id, msg);
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

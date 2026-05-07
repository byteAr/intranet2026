import {
  Controller,
  Delete,
  Get,
  Post,
  Param,
  Query,
  Req,
  Res,
  Body,
  NotFoundException,
  BadRequestException,
  UseInterceptors,
  UseGuards,
  UploadedFile,
  UploadedFiles,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage, memoryStorage } from 'multer';
import { Response } from 'express';
import { existsSync, mkdirSync, createReadStream } from 'fs';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { MailService } from './mail.service';
import { SmtpSenderService } from './smtp-sender.service';
import { MailIngestService } from './mail-ingest.service';
import { LdapRecipientsService } from './ldap-recipients.service';
import { DecryptedAttachmentService } from './decrypted-attachment.service';
import { SienaFileService } from './siena-file.service';
import { BridgeSecretGuard } from './guards/bridge-secret.guard';
import { QueryEmailsDto } from './dto/query-emails.dto';
import { SendEmailDto } from './dto/send-email.dto';
import { IngestEmailDto } from './dto/ingest-email.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';

@Controller('mail')
export class MailController {
  constructor(
    private readonly mailService: MailService,
    private readonly smtpSender: SmtpSenderService,
    private readonly mailIngestService: MailIngestService,
    private readonly ldapRecipientsService: LdapRecipientsService,
    private readonly decryptedService: DecryptedAttachmentService,
    private readonly sienaFileService: SienaFileService,
  ) {}

  @Get('unread-counts')
  async getUnreadCounts(@Req() req: any) {
    return this.mailService.getUnreadCounts(req.user.id);
  }

  @Get('emails')
  async findAll(@Query() query: QueryEmailsDto, @Req() req: any) {
    return this.mailService.findAll(query, req.user.id);
  }

  @Get('emails/search')
  async search(@Query('q') q: string, @Req() req: any) {
    if (!q?.trim()) throw new BadRequestException('Parámetro q requerido');
    return this.mailService.findAll({ q: q.trim(), page: 1, limit: 30 }, req.user.id);
  }

  @Get('emails/:id')
  async findOne(@Param('id') id: string, @Req() req: any) {
    return this.mailService.findOne(id, req.user.id, req.user.roles);
  }

  @Get('emails/:id/tree')
  async getTree(@Param('id') id: string, @Req() req: any) {
    const email = await this.mailService.findOne(id, req.user.id);
    if (!email.mailCode) return [];
    return this.mailService.getTree(email.mailCode);
  }

  @Get('emails/:id/attachments/:aid/preview')
  async previewAttachment(
    @Param('id') id: string,
    @Param('aid') aid: string,
    @Res() res: Response,
  ) {
    let att: any;
    try {
      att = await this.mailService.getAttachment(id, aid);
    } catch {
      res.status(404).json({ message: 'Adjunto no encontrado' });
      return;
    }

    if (!existsSync(att.storagePath)) {
      res.status(404).json({ message: 'Archivo no encontrado en disco' });
      return;
    }

    const baseMime = (att.contentType ?? '').split(';')[0].trim().toLowerCase() || 'application/octet-stream';
    res.setHeader('Content-Type', baseMime);
    res.setHeader('Content-Disposition', `inline; filename="${att.filename}"`);
    createReadStream(att.storagePath).pipe(res);
  }

  @Get('emails/:id/attachments/:aid')
  async downloadAttachment(
    @Param('id') id: string,
    @Param('aid') aid: string,
    @Res() res: Response,
  ) {
    const att = await this.mailService.getAttachment(id, aid);
    if (!existsSync(att.storagePath)) throw new NotFoundException('Archivo no encontrado en disco');
    res.download(att.storagePath, att.filename);
  }

  @Post('emails/:id/read')
  async markRead(@Param('id') id: string, @Req() req: any) {
    await this.mailService.markRead(id, req.user.id);
    return { ok: true };
  }

  @Post('emails/send')
  @Roles('TICOM')
  @UseInterceptors(FilesInterceptor('files', 10, { storage: memoryStorage() }))
  async send(
    @Body() dto: SendEmailDto,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.smtpSender.send(dto, files ?? []);
  }

  @Post('emails/:id/attachments/:aid/decrypted')
  @Roles('TICOM')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const dest = process.env.DECRYPTED_ATTACHMENTS_PATH ?? '/app/storage/decrypted-attachments';
          mkdirSync(dest, { recursive: true });
          cb(null, dest);
        },
        filename: (_req, file, cb) => {
          const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
          cb(null, `${randomUUID()}_${safe}`);
        },
      }),
    }),
  )
  async uploadDecrypted(
    @Param('id') id: string,
    @Param('aid') aid: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: any,
  ) {
    if (!file) throw new BadRequestException('Se requiere un archivo');
    const dec = await this.decryptedService.upload(
      id, aid, file, req.user.id, req.user.displayName ?? req.user.username,
    );
    return { id: dec.id, filename: dec.filename, size: dec.size, uploadedAt: dec.uploadedAt, uploadedByName: dec.uploadedByName };
  }

  @Get('emails/:id/attachments/:aid/decrypted')
  @Roles('ENCRIPTADO')
  async downloadDecrypted(
    @Param('id') id: string,
    @Param('aid') aid: string,
    @Res() res: Response,
  ) {
    const dec = await this.decryptedService.get(id, aid);
    res.download(dec.storagePath, dec.filename);
  }

  @Delete('emails/:id/attachments/:aid/decrypted')
  @Roles('TICOM')
  async deleteDecrypted(
    @Param('id') id: string,
    @Param('aid') aid: string,
  ) {
    await this.decryptedService.remove(id, aid);
    return { ok: true };
  }

  @Post('emails/:id/siena-files')
  @Roles('TICOM')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          SienaFileService.ensureStorageDir();
          cb(null, SienaFileService.getStoragePath());
        },
        filename: (_req, file, cb) => {
          const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
          cb(null, `${randomUUID()}_${safe}`);
        },
      }),
    }),
  )
  async uploadSienaFile(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: any,
  ) {
    if (!file) throw new BadRequestException('Se requiere un archivo');
    const f = await this.sienaFileService.upload(
      id, file, req.user.id, req.user.displayName ?? req.user.username,
    );
    return { id: f.id, filename: f.filename, size: f.size, uploadedAt: f.uploadedAt, uploadedByName: f.uploadedByName };
  }

  @Get('emails/:id/siena-files/:fid')
  @Roles('ENCRIPTADO')
  async downloadSienaFile(
    @Param('id') id: string,
    @Param('fid') fid: string,
    @Res() res: Response,
  ) {
    const f = await this.sienaFileService.get(id, fid);
    res.download(f.storagePath, f.filename);
  }

  @Delete('emails/:id/siena-files/:fid')
  @Roles('TICOM')
  async deleteSienaFile(
    @Param('id') id: string,
    @Param('fid') fid: string,
  ) {
    await this.sienaFileService.remove(id, fid);
    return { ok: true };
  }

  @Get('bridge/next-send')
  @Public()
  @UseGuards(BridgeSecretGuard)
  async getNextSend() {
    const pending = await this.smtpSender.getNextPendingSend();
    return pending ?? null;
  }

  @Post('bridge/send-done')
  @Public()
  @UseGuards(BridgeSecretGuard)
  async sendDone(@Body() body: { id: string; messageId?: string; error?: string }) {
    await this.smtpSender.processSendResult(body.id, body.messageId, body.error);
    return { ok: true };
  }

  @Post('bridge/ingest')
  @Public()
  @UseGuards(BridgeSecretGuard)
  async bridgeIngest(@Body() dto: IngestEmailDto) {
    const attachments = (dto.attachments ?? []).map((a) => ({
      filename: a.filename,
      contentType: a.contentType,
      data: Buffer.from(a.base64, 'base64'),
    }));
    const result = await this.mailIngestService.ingest({
      ...dto,
      ccAddresses: dto.ccAddresses ?? [],
      date: new Date(dto.date),
      attachments,
    });
    if (result.skipped) return { ok: true, skipped: true };
    return { ok: true, id: result.saved!.id };
  }

  @Get('bridge/recipients')
  async bridgeRecipients(@Query('q') q: string) {
    if (!q?.trim()) throw new BadRequestException('Parámetro q requerido');
    return this.ldapRecipientsService.search(q.trim());
  }
}

import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Req,
  Res,
  Body,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  UseInterceptors,
  UseGuards,
  UploadedFiles,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Response } from 'express';
import { existsSync } from 'fs';
import { ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';
import { SmtpSenderService } from './smtp-sender.service';
import { MailIngestService } from './mail-ingest.service';
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
    private readonly configService: ConfigService,
  ) {}

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
    return this.mailService.findOne(id, req.user.id);
  }

  @Get('emails/:id/tree')
  async getTree(@Param('id') id: string, @Req() req: any) {
    const email = await this.mailService.findOne(id, req.user.id);
    if (!email.mailCode) return [];
    return this.mailService.getTree(email.mailCode);
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
    const bridgeUrl = this.configService.get<string>('MAIL_BRIDGE_URL');
    if (!bridgeUrl) return [];

    const secret = this.configService.get<string>('MAIL_BRIDGE_SECRET') ?? '';
    const res = await fetch(
      `${bridgeUrl}/ldap-search?q=${encodeURIComponent(q.trim())}`,
      { headers: { Authorization: `Bearer ${secret}` } },
    );
    if (!res.ok) throw new InternalServerErrorException('Error al consultar la libreta');
    return res.json();
  }
}

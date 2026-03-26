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
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Response } from 'express';
import { existsSync } from 'fs';
import { MailService } from './mail.service';
import { SmtpSenderService } from './smtp-sender.service';
import { QueryEmailsDto } from './dto/query-emails.dto';
import { SendEmailDto } from './dto/send-email.dto';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('mail')
export class MailController {
  constructor(
    private readonly mailService: MailService,
    private readonly smtpSender: SmtpSenderService,
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
}

import {
  Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Request,
  UploadedFiles, UseInterceptors, Res,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, createReadStream, unlinkSync } from 'fs';
import { Response } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DraftMailService } from './draft-mail.service';
import { CreateDraftDto } from './dto/create-draft.dto';
import { UpdateDraftDto } from './dto/update-draft.dto';
import { ReviewActionDto } from './dto/review-action.dto';
import { SendDraftDto } from './dto/send-draft.dto';
import { DelegateDto } from './dto/delegate.dto';
import { AddAuthorizerDto } from './dto/add-authorizer.dto';
import { SetDirectorDto } from './dto/set-director.dto';
import { DraftEmailAttachment } from './entities/draft-email-attachment.entity';
import { User } from '../users/entities/user.entity';

const STORAGE_PATH = process.env.DRAFT_ATTACHMENTS_PATH ?? '/app/storage/draft-attachments';

@Controller('draft-mail')
export class DraftMailController {
  constructor(
    private readonly service: DraftMailService,
    @InjectRepository(DraftEmailAttachment)
    private readonly attachmentRepo: Repository<DraftEmailAttachment>,
  ) {}

  @Get('next-mailcode')
  getNextMailCode() {
    return this.service.getNextMailCode().then((code) => ({ code }));
  }

  @Get('para-enviar')
  findApproved(@Request() req: { user: User }) {
    if (!this.service.isTicom(req.user)) return [];
    return this.service.findApproved();
  }

  @Get('hash/:hash')
  async findByHash(@Param('hash') hash: string, @Request() req: { user: User }) {
    if (!this.service.isTicom(req.user)) throw new NotFoundException();
    const draft = await this.service.findByHash(hash);
    if (!draft) throw new NotFoundException('No hay ningún correo para enviar con ese hash');
    return draft;
  }

  @Get('is-authorizer')
  async isAuthorizer(@Request() req: { user: User }) {
    return { value: await this.service.isAuthorizer(req.user) };
  }

  @Get('pending-count')
  async getPendingCount(@Request() req: { user: User }) {
    return { count: await this.service.getPendingCountForAuthorizer(req.user) };
  }

  @Get('approved-count')
  async getApprovedCount(@Request() req: { user: User }) {
    if (!this.service.isTicom(req.user)) return { count: 0 };
    return { count: await this.service.getApprovedCount() };
  }

  @Get('director')
  getDirector() {
    return this.service.getDirector();
  }

  @Post('director')
  setDirector(@Body() dto: SetDirectorDto, @Request() req: { user: User }) {
    return this.service.setDirector(dto, req.user);
  }

  @Delete('director')
  removeDirector(@Request() req: { user: User }) {
    return this.service.removeDirector(req.user);
  }

  @Get('authorizers')
  async getAuthorizers(@Request() req: { user: User }) {
    if (!(await this.service.isSuperApprover(req.user))) return [];
    return this.service.getAuthorizers();
  }

  @Post('authorizers')
  addAuthorizer(@Body() dto: AddAuthorizerDto, @Request() req: { user: User }) {
    return this.service.addAuthorizer(dto, req.user);
  }

  @Delete('authorizers/:userId')
  removeAuthorizer(@Param('userId') userId: string, @Request() req: { user: User }) {
    return this.service.removeAuthorizer(userId, req.user);
  }

  @Get()
  findAll(@Request() req: { user: User }) {
    return this.service.findAllForUser(req.user);
  }

  @Post()
  @UseInterceptors(FilesInterceptor('files', 10, {
    storage: diskStorage({
      destination: (req, file, cb) => {
        if (!existsSync(STORAGE_PATH)) mkdirSync(STORAGE_PATH, { recursive: true });
        cb(null, STORAGE_PATH);
      },
      filename: (req, file, cb) => {
        cb(null, `${randomUUID()}${extname(file.originalname)}`);
      },
    }),
    limits: { fileSize: 20 * 1024 * 1024 },
  }))
  async create(
    @Body() dto: CreateDraftDto,
    @UploadedFiles() files: Express.Multer.File[],
    @Request() req: { user: User },
  ) {
    const draft = await this.service.create(dto, req.user);
    if (files?.length) {
      const attachments = files.map((f) => ({
        draftEmailId: draft.id,
        filename: f.originalname,
        contentType: f.mimetype,
        size: f.size,
        storagePath: f.path,
      }));
      await this.attachmentRepo.save(attachments);
    }
    return this.service.findOne(draft.id, req.user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req: { user: User }) {
    return this.service.findOne(id, req.user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateDraftDto, @Request() req: { user: User }) {
    return this.service.update(id, dto, req.user);
  }

  @Delete(':id')
  deleteDraft(@Param('id') id: string, @Request() req: { user: User }) {
    return this.service.deleteDraft(id, req.user);
  }

  @Post(':id/submit')
  submit(@Param('id') id: string, @Request() req: { user: User }) {
    return this.service.submit(id, req.user);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @Request() req: { user: User }) {
    return this.service.approve(id, req.user);
  }

  @Post(':id/reject')
  reject(@Param('id') id: string, @Body() dto: ReviewActionDto, @Request() req: { user: User }) {
    return this.service.reject(id, dto, req.user);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @Body() dto: ReviewActionDto, @Request() req: { user: User }) {
    return this.service.cancel(id, dto, req.user);
  }

  @Post(':id/ticom-cancel')
  ticomCancel(@Param('id') id: string, @Body() dto: ReviewActionDto, @Request() req: { user: User }) {
    return this.service.ticomCancel(id, dto, req.user);
  }

  @Post(':id/delegate')
  delegate(@Param('id') id: string, @Body() dto: DelegateDto, @Request() req: { user: User }) {
    return this.service.delegate(id, dto, req.user);
  }

  @Post(':id/toggle-encryption')
  toggleEncryption(@Param('id') id: string, @Request() req: { user: User }) {
    return this.service.toggleEncryption(id, req.user);
  }

  @Post(':id/enter-hash')
  enterHash(@Param('id') id: string, @Body() body: { hash: string }, @Request() req: { user: User }) {
    return this.service.enterHash(id, body.hash, req.user);
  }

  @Post(':id/send')
  send(@Param('id') id: string, @Body() dto: SendDraftDto, @Request() req: { user: User }) {
    return this.service.send(id, dto, req.user);
  }

  @Post(':id/attachments')
  @UseInterceptors(FilesInterceptor('files', 10, {
    storage: diskStorage({
      destination: (req, file, cb) => {
        if (!existsSync(STORAGE_PATH)) mkdirSync(STORAGE_PATH, { recursive: true });
        cb(null, STORAGE_PATH);
      },
      filename: (req, file, cb) => {
        cb(null, `${randomUUID()}${extname(file.originalname)}`);
      },
    }),
    limits: { fileSize: 20 * 1024 * 1024 },
  }))
  async addAttachments(
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Request() req: { user: User },
  ) {
    await this.service.findOne(id, req.user);
    if (files?.length) {
      const attachments = files.map((f) => ({
        draftEmailId: id,
        filename: f.originalname,
        contentType: f.mimetype,
        size: f.size,
        storagePath: f.path,
      }));
      await this.attachmentRepo.save(attachments);
    }
    return this.service.findOne(id, req.user);
  }

  @Delete(':id/attachments/:attId')
  async deleteAttachment(
    @Param('id') id: string,
    @Param('attId') attId: string,
    @Request() req: { user: User },
  ) {
    await this.service.findOne(id, req.user);
    const att = await this.attachmentRepo.findOne({ where: { id: attId, draftEmailId: id } });
    if (!att) throw new NotFoundException('Adjunto no encontrado');
    if (existsSync(att.storagePath)) unlinkSync(att.storagePath);
    await this.attachmentRepo.delete(att.id);
    return this.service.findOne(id, req.user);
  }

  @Get(':id/attachments/:attId')
  async downloadAttachment(
    @Param('id') id: string,
    @Param('attId') attId: string,
    @Request() req: { user: User },
    @Res() res: Response,
  ) {
    await this.service.findOne(id, req.user); // access check
    const att = await this.attachmentRepo.findOne({ where: { id: attId, draftEmailId: id } });
    if (!att || !existsSync(att.storagePath)) throw new NotFoundException('Adjunto no encontrado');
    res.setHeader('Content-Disposition', `attachment; filename="${att.filename}"`);
    res.setHeader('Content-Type', att.contentType);
    createReadStream(att.storagePath).pipe(res);
  }
}

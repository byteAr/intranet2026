import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  Query,
  Req,
  Res,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { Response } from 'express';
import { IncidentsService } from './incidents.service';
import { IncidentsGateway } from './incidents.gateway';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';

const UPLOAD_DIR = '/app/uploads/incidents';

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

@Controller('incidents')
export class IncidentsController {
  constructor(
    private readonly incidentsService: IncidentsService,
    private readonly incidentsGateway: IncidentsGateway,
  ) {}

  @Post()
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
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_TYPES.has(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new BadRequestException('Solo se permiten imágenes (JPG, PNG, GIF, WebP)'), false);
        }
      },
    }),
  )
  async create(
    @Req() req: any,
    @Body('description') description: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!description?.trim()) {
      throw new BadRequestException('La descripción es obligatoria');
    }
    const user = req.user;
    const incident = await this.incidentsService.create({
      creatorId: user.id,
      creatorName: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.displayName || user.username,
      creatorAvatar: user.avatar,
      description: description.trim(),
      attachmentUrl: file ? `/api/incidents/files/${file.filename}` : undefined,
      attachmentName: file?.originalname,
      attachmentSize: file?.size,
      attachmentMimeType: file?.mimetype,
    });
    this.incidentsGateway.notifyNewIncident(incident);
    return incident;
  }

  @Get()
  async findAll(
    @Req() req: any,
    @Query('status') status?: string,
    @Query('mine') mine?: string,
  ) {
    const user = req.user;
    const isTicom = user.roles?.includes('TICOM');
    if (mine === 'true' || !isTicom) {
      return this.incidentsService.findAll({ creatorId: user.id, status });
    }
    return this.incidentsService.findAll({ status });
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

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const incident = await this.incidentsService.findById(id);
    if (!incident) throw new NotFoundException('Incidencia no encontrada');
    return incident;
  }

  @Patch(':id/assign')
  @Roles('TICOM')
  async assign(@Param('id') id: string, @Req() req: any) {
    const user = req.user;
    const techName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.displayName || user.username;
    const incident = await this.incidentsService.assign(id, user.id, techName);
    this.incidentsGateway.notifyIncidentUpdate(incident);
    return incident;
  }

  @Patch(':id/resolve')
  @Roles('TICOM')
  async resolve(
    @Param('id') id: string,
    @Req() req: any,
    @Body('resolution') resolution: string,
  ) {
    if (!resolution?.trim()) {
      throw new BadRequestException('La resolución es obligatoria');
    }
    const incident = await this.incidentsService.resolve(id, req.user.id, resolution.trim());
    this.incidentsGateway.notifyIncidentUpdate(incident);
    return incident;
  }
}

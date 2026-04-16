import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { existsSync, unlinkSync } from 'fs';
import { DecryptedAttachment } from './entities/decrypted-attachment.entity';
import { Attachment } from './entities/attachment.entity';

@Injectable()
export class DecryptedAttachmentService {
  constructor(
    @InjectRepository(DecryptedAttachment)
    private readonly repo: Repository<DecryptedAttachment>,
    @InjectRepository(Attachment)
    private readonly attachmentRepo: Repository<Attachment>,
  ) {}

  async upload(
    emailId: string,
    attachmentId: string,
    file: Express.Multer.File,
    uploadedById: string,
    uploadedByName: string,
  ): Promise<DecryptedAttachment> {
    const att = await this.attachmentRepo.findOne({ where: { id: attachmentId, emailId } });
    if (!att) throw new NotFoundException('Adjunto no encontrado');
    if (!att.filename.endsWith('._00')) {
      throw new BadRequestException('El adjunto no es un archivo encriptado (._00)');
    }

    const existing = await this.repo.findOne({ where: { attachmentId } });

    // diskStorage ya escribió el archivo en su destino definitivo (file.path)
    const fullPath = file.path;

    // Si ya existía uno anterior, borrar el archivo físico previo
    if (existing) {
      try { unlinkSync(existing.storagePath); } catch { /* ya borrado */ }
      existing.filename = file.originalname;
      existing.contentType = file.mimetype || 'application/octet-stream';
      existing.size = file.size;
      existing.storagePath = fullPath;
      existing.uploadedById = uploadedById;
      existing.uploadedByName = uploadedByName;
      existing.uploadedAt = new Date();
      return this.repo.save(existing);
    }

    return this.repo.save(
      this.repo.create({
        attachmentId,
        emailId,
        filename: file.originalname,
        contentType: file.mimetype || 'application/octet-stream',
        size: file.size,
        storagePath: fullPath,
        uploadedById,
        uploadedByName,
      }),
    );
  }

  async get(emailId: string, attachmentId: string): Promise<DecryptedAttachment> {
    const att = await this.attachmentRepo.findOne({ where: { id: attachmentId, emailId } });
    if (!att) throw new NotFoundException('Adjunto no encontrado');

    const dec = await this.repo.findOne({ where: { attachmentId } });
    if (!dec) throw new NotFoundException('Archivo desencriptado no disponible aún');
    if (!existsSync(dec.storagePath)) throw new NotFoundException('Archivo no encontrado en disco');
    return dec;
  }

  async remove(emailId: string, attachmentId: string): Promise<void> {
    const att = await this.attachmentRepo.findOne({ where: { id: attachmentId, emailId } });
    if (!att) throw new NotFoundException('Adjunto no encontrado');

    const dec = await this.repo.findOne({ where: { attachmentId } });
    if (!dec) throw new NotFoundException('Desencriptado no encontrado');

    try { unlinkSync(dec.storagePath); } catch { /* ya borrado */ }
    await this.repo.remove(dec);
  }

  async getDecryptedIds(attachmentIds: string[]): Promise<Set<string>> {
    if (!attachmentIds.length) return new Set();
    const rows = await this.repo.find({
      where: attachmentIds.map((id) => ({ attachmentId: id })),
      select: ['attachmentId'],
    });
    return new Set(rows.map((r) => r.attachmentId));
  }
}

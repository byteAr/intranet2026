import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { SienaFile } from './entities/siena-file.entity';
import { Email } from './entities/email.entity';

const SIENA_PATTERN = /SOFTWARE\s+SIENA/i;

@Injectable()
export class SienaFileService {
  static isSienaBody(bodyText: string | null | undefined): boolean {
    return SIENA_PATTERN.test(bodyText ?? '');
  }
  constructor(
    @InjectRepository(SienaFile)
    private readonly repo: Repository<SienaFile>,
    @InjectRepository(Email)
    private readonly emailRepo: Repository<Email>,
  ) {}

  async upload(
    emailId: string,
    file: Express.Multer.File,
    uploadedById: string,
    uploadedByName: string,
  ): Promise<SienaFile> {
    const email = await this.emailRepo.findOne({ where: { id: emailId } });
    if (!email) throw new NotFoundException('Correo no encontrado');

    return this.repo.save(
      this.repo.create({
        emailId,
        filename: file.originalname,
        contentType: file.mimetype || 'application/octet-stream',
        size: file.size,
        storagePath: file.path,
        uploadedById,
        uploadedByName,
      }),
    );
  }

  async list(emailId: string): Promise<SienaFile[]> {
    return this.repo.find({ where: { emailId }, order: { uploadedAt: 'ASC' } });
  }

  async get(emailId: string, fileId: string): Promise<SienaFile> {
    const f = await this.repo.findOne({ where: { id: fileId, emailId } });
    if (!f) throw new NotFoundException('Archivo no encontrado');
    if (!existsSync(f.storagePath)) throw new NotFoundException('Archivo no encontrado en disco');
    return f;
  }

  async remove(emailId: string, fileId: string): Promise<void> {
    const f = await this.repo.findOne({ where: { id: fileId, emailId } });
    if (!f) throw new NotFoundException('Archivo no encontrado');
    try { unlinkSync(f.storagePath); } catch { /* ya borrado */ }
    await this.repo.remove(f);
  }

  async getForEmail(emailId: string): Promise<SienaFile[]> {
    return this.repo.find({ where: { emailId }, order: { uploadedAt: 'ASC' } });
  }

  static getStoragePath(): string {
    return process.env.SIENA_FILES_PATH ?? '/app/storage/siena-files';
  }

  static ensureStorageDir(): void {
    mkdirSync(SienaFileService.getStoragePath(), { recursive: true });
  }
}

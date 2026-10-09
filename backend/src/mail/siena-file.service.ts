import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { SienaFile } from './entities/siena-file.entity';
import { Email } from './entities/email.entity';

/**
 * MTO enviado por SIENA. Hasta el 09/10/2026 solo se reconocía "SOFTWARE SIENA"
 * y se escapaban los que dicen "CIFRADO MEDIANTE SISTEMA SIENA" (IFM 839/26):
 * ahí no se podía subir el archivo desencriptado. Ahora cuenta también
 * "SISTEMA/PLATAFORMA SIENA", el enlace de descarga de siena.gna.gob.ar y
 * "SIENA" en el asunto.
 */
const SIENA_BODY = /\b(SOFTWARE|SISTEMA|PLATAFORMA)\s+SIENA\b|siena\.gna\.gob\.ar/i;
const SIENA_SUBJECT = /\bSIENA\b/i;

@Injectable()
export class SienaFileService {
  static isSiena(subject: string | null | undefined, bodyText: string | null | undefined): boolean {
    return SIENA_BODY.test(bodyText ?? '') || SIENA_SUBJECT.test(subject ?? '');
  }
  constructor(
    @InjectRepository(SienaFile)
    private readonly repo: Repository<SienaFile>,
    @InjectRepository(Email)
    private readonly emailRepo: Repository<Email>,
  ) {}

  /** Uno o varios archivos SIENA desencriptados (se suman a los que ya hay). */
  async upload(
    emailId: string,
    files: Express.Multer.File[],
    uploadedById: string,
    uploadedByName: string,
  ): Promise<SienaFile[]> {
    const email = await this.emailRepo.findOne({ where: { id: emailId } });
    if (!email) {
      // diskStorage ya escribió los archivos: no dejarlos huérfanos
      for (const f of files) { try { unlinkSync(f.path); } catch { /* ya borrado */ } }
      throw new NotFoundException('Correo no encontrado');
    }

    return this.repo.save(
      files.map((file) =>
        this.repo.create({
          emailId,
          // multer entrega el nombre en latin1: así se conservan las tildes
          filename: Buffer.from(file.originalname, 'latin1').toString('utf8'),
          contentType: file.mimetype || 'application/octet-stream',
          size: file.size,
          storagePath: file.path,
          uploadedById,
          uploadedByName,
        }),
      ),
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

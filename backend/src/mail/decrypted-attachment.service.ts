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

  /**
   * Agrega uno o varios desencriptados al adjunto .~NN (un .rar encriptado puede
   * traer varios documentos). No reemplaza los que ya estaban: si TICOM se
   * equivocó, borra ese y sube el correcto.
   */
  async upload(
    emailId: string,
    attachmentId: string,
    files: Express.Multer.File[],
    uploadedById: string,
    uploadedByName: string,
  ): Promise<DecryptedAttachment[]> {
    const att = await this.attachmentRepo.findOne({ where: { id: attachmentId, emailId } });
    if (!att || !/\.\~\d{2}$/.test(att.filename)) {
      // diskStorage ya escribió los archivos: no dejarlos huérfanos
      for (const f of files) { try { unlinkSync(f.path); } catch { /* ya borrado */ } }
      if (!att) throw new NotFoundException('Adjunto no encontrado');
      throw new BadRequestException('El adjunto no es un archivo encriptado (.~00)');
    }

    return this.repo.save(
      files.map((file) =>
        this.repo.create({
          attachmentId,
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

  /** Un desencriptado puntual; sin `decryptedId`, el primero (pestañas con la versión anterior). */
  async get(emailId: string, attachmentId: string, decryptedId?: string): Promise<DecryptedAttachment> {
    const att = await this.attachmentRepo.findOne({ where: { id: attachmentId, emailId } });
    if (!att) throw new NotFoundException('Adjunto no encontrado');

    const dec = await this.repo.findOne({
      where: decryptedId ? { id: decryptedId, attachmentId } : { attachmentId },
      order: { uploadedAt: 'ASC' },
    });
    if (!dec) throw new NotFoundException('Archivo desencriptado no disponible aún');
    if (!existsSync(dec.storagePath)) throw new NotFoundException('Archivo no encontrado en disco');
    return dec;
  }

  async remove(emailId: string, attachmentId: string, decryptedId: string): Promise<void> {
    const att = await this.attachmentRepo.findOne({ where: { id: attachmentId, emailId } });
    if (!att) throw new NotFoundException('Adjunto no encontrado');

    const dec = await this.repo.findOne({ where: { id: decryptedId, attachmentId } });
    if (!dec) throw new NotFoundException('Desencriptado no encontrado');

    try { unlinkSync(dec.storagePath); } catch { /* ya borrado */ }
    await this.repo.remove(dec);
  }
}

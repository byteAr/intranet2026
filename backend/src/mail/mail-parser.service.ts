import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MailFolder } from './entities/email.entity';
import { EmailReference } from './entities/email-reference.entity';

// Matches institutional codes like "DE 130/19", "DE130/19", "DE 130 / 19", "DE130 /19", etc.
// Normalised form is always "PREFIX NUM/YY" (single space, no spaces around /).
const CODE_REGEX = /\b([A-ZÁÉÍÓÚÑ]{2,5})[ \t]*(\d{1,4})[ \t]*\/[ \t]*(\d{2})\b/g;
const OUR_ADDRESS = 'DIREDTOS@MTO.GNA';
const REDGEN_ADDRESS = 'REDGEN@MTO.GNA';

export interface ParsedMailData {
  mailCode: string | null;
  folder: MailFolder;
  references: string[];
}

@Injectable()
export class MailParserService {
  constructor(
    @InjectRepository(EmailReference)
    private readonly refRepo: Repository<EmailReference>,
  ) {}

  /**
   * Classifies an email into a folder based on TO/CC/FROM addresses.
   * Priority: tx → redgen → ejecutivos → informativos
   */
  classifyFolder(
    fromAddress: string,
    toAddresses: string[],
    ccAddresses: string[],
  ): MailFolder {
    const normalize = (addr: string) => addr.toUpperCase().trim();
    const from = normalize(fromAddress);
    const toList = toAddresses.map(normalize);
    const ccList = ccAddresses.map(normalize);

    // Match full address OR just the username part (handles PST display names)
    const matchAddr = (list: string[], target: string): boolean => {
      const username = target.split('@')[0];
      return list.some((a) => a.includes(target) || a === username || a.startsWith(username + ' '));
    };

    const ourUsername = OUR_ADDRESS.split('@')[0]; // 'DIREDTOS'
    if (from.includes(OUR_ADDRESS) || from === ourUsername || from.endsWith('CN=' + ourUsername)) return MailFolder.TX;

    if (matchAddr(toList, REDGEN_ADDRESS) || matchAddr(ccList, REDGEN_ADDRESS)) return MailFolder.REDGEN;
    if (matchAddr(toList, OUR_ADDRESS)) return MailFolder.EJECUTIVOS;
    if (matchAddr(ccList, OUR_ADDRESS)) return MailFolder.INFORMATIVOS;

    // Fallback: if none matched, treat as informativo
    return MailFolder.INFORMATIVOS;
  }

  /**
   * Extracts the mail code and all referenced codes from the email body.
   * First match → mailCode. Subsequent matches → references list.
   */
  extractCodes(bodyText: string): { mailCode: string | null; references: string[] } {
    if (!bodyText) return { mailCode: null, references: [] };

    // The email's own code always appears at the very start of the body (first ~150 chars).
    // If no code is found there, this is an informal message (e.g. starts with "NOTA") — no mailCode.
    const headMatch = new RegExp(CODE_REGEX.source, CODE_REGEX.flags).exec(bodyText.slice(0, 150));
    const mailCode = headMatch ? `${headMatch[1]} ${headMatch[2]}/${headMatch[3]}` : null;

    // Collect all codes in the full body, excluding mailCode (those are references to other emails)
    const seen = new Set<string>(mailCode ? [mailCode] : []);
    const references: string[] = [];
    const regex = new RegExp(CODE_REGEX.source, CODE_REGEX.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(bodyText)) !== null) {
      const code = `${match[1]} ${match[2]}/${match[3]}`;
      if (!seen.has(code)) {
        seen.add(code);
        references.push(code);
      }
    }

    return { mailCode, references };
  }

  /**
   * Full parse: classify folder + extract codes.
   */
  parse(
    fromAddress: string,
    toAddresses: string[],
    ccAddresses: string[],
    bodyText: string,
  ): ParsedMailData {
    const folder = this.classifyFolder(fromAddress, toAddresses, ccAddresses);
    const { mailCode, references } = this.extractCodes(bodyText);
    return { mailCode, folder, references };
  }

  /**
   * When a new email is saved, resolve any pending references that point to its mailCode.
   * Returns the number of references resolved.
   */
  async resolvePendingReferences(emailId: string, mailCode: string | null): Promise<number> {
    if (!mailCode) return 0;

    const result = await this.refRepo
      .createQueryBuilder()
      .update(EmailReference)
      .set({ referencedEmailId: emailId })
      .where('"referencedCode" = :code', { code: mailCode })
      .andWhere('"referencedEmailId" IS NULL')
      .execute();

    return result.affected ?? 0;
  }

  /**
   * Creates EmailReference rows for a newly saved email.
   * referencedEmailId is resolved immediately if a matching email already exists.
   */
  async saveReferences(
    emailId: string,
    referencedCodes: string[],
    resolveExisting: (code: string) => Promise<string | null>,
  ): Promise<void> {
    if (referencedCodes.length === 0) return;

    const rows = await Promise.all(
      referencedCodes.map(async (code) => {
        const resolved = await resolveExisting(code);
        return {
          emailId,
          referencedCode: code,
          ...(resolved ? { referencedEmailId: resolved } : {}),
        };
      }),
    );

    await this.refRepo.save(rows as EmailReference[]);
  }
}

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MailFolder } from './entities/email.entity';
import { EmailReference } from './entities/email-reference.entity';

// Matches institutional codes like "DE 130/19", "DE130/19", "AA 12../19", "ES 1266/1.-9", etc.
// - Tolerates dots before slash ("12../19")
// - Tolerates noise (dots/hyphens) inside the 2-digit year ("1.-9" → "19")
// Normalised form is always "PREFIX NUM/YY" (single space, no spaces/noise).
// When using match[3], call .replace(/\D/g,'') to strip noise from the year capture.
const CODE_REGEX = /\b([A-ZÁÉÍÓÚÑ]{1,4})[ \t]*(\d+)[ \t.]*\/[ \t]*(\d[.-]*\d)\b/g;

// Partial match for codes missing the /YY suffix (typo: "AB 22" instead of "AB 22/26").
// Only used when trying to extract the mailCode from the head of the email.
const PARTIAL_CODE_REGEX = /\b([A-ZÁÉÍÓÚÑ]{1,4})[ \t]*(\d+)\b/;

// Prefixes that are NEVER email codes — just institutional indicators in the body.
// PON = encryption indicator for attachments ("PON 33/96" is a crypto key, not an email ref).
const EXCLUDED_PREFIXES = new Set(['PON']);

// Service/correction message prefixes — the actual mail code follows after them.
// "SVC AB 123/22" → mailCode is "AB 123/22" (SVC = corrige un envío anterior)
// "MTP ABC 123/22" → mailCode is "ABC 123/22" (MTP = mensaje no oficial)
const SERVICE_PREFIX_RE = /^[ \t]*(SVC|MTP)[ \t]+/i;

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
   *
   * Rules:
   * - Own code is the first institutional code in the first ~150 chars.
   * - SVC/MTP prefix is stripped before searching (e.g. "SVC AB 123/22" → mailCode "AB 123/22").
   * - If no full code (with /YY) is found in the head, tries a partial match (PREFIX NUM) and
   *   infers the year from emailDate if provided (e.g. "AB 22" sent in 2026 → "AB 22/26").
   * - PON codes are never treated as mail codes or references (they are encryption indicators).
   * - Dots between number and slash are tolerated ("AA 12../19" → "AA 12/19").
   */
  extractCodes(
    bodyText: string,
    emailDate?: Date | string,
  ): { mailCode: string | null; references: string[] } {
    if (!bodyText) return { mailCode: null, references: [] };

    // Strip SVC/MTP prefix from head to find the actual mailCode
    const rawHead = bodyText.slice(0, 150);
    const headForMailCode = rawHead.replace(SERVICE_PREFIX_RE, '');

    // Try full regex match (with /YY) in head
    let mailCode: string | null = null;
    const fullMatch = new RegExp(CODE_REGEX.source, CODE_REGEX.flags).exec(headForMailCode);
    if (fullMatch && !EXCLUDED_PREFIXES.has(fullMatch[1])) {
      mailCode = `${fullMatch[1]} ${fullMatch[2]}/${fullMatch[3].replace(/\D/g, '')}`;
    }

    // If no full match, try partial (missing /YY) and infer year from email date
    if (!mailCode && emailDate) {
      const partialMatch = PARTIAL_CODE_REGEX.exec(headForMailCode);
      if (partialMatch && !EXCLUDED_PREFIXES.has(partialMatch[1])) {
        const yy = new Date(emailDate).getFullYear().toString().slice(-2);
        mailCode = `${partialMatch[1]} ${partialMatch[2]}/${yy}`;
      }
    }

    // Collect all full codes in the body, skipping mailCode and PON codes
    const seen = new Set<string>(mailCode ? [mailCode] : []);
    const references: string[] = [];
    const regex = new RegExp(CODE_REGEX.source, CODE_REGEX.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(bodyText)) !== null) {
      if (EXCLUDED_PREFIXES.has(match[1])) continue;
      const code = `${match[1]} ${match[2]}/${match[3].replace(/\D/g, '')}`;
      if (!seen.has(code)) {
        seen.add(code);
        references.push(code);
      }
    }

    return { mailCode, references };
  }

  /**
   * Full parse: classify folder + extract codes.
   * emailDate is used to infer the year when a code is missing its /YY suffix.
   */
  parse(
    fromAddress: string,
    toAddresses: string[],
    ccAddresses: string[],
    bodyText: string,
    emailDate?: Date | string,
  ): ParsedMailData {
    const folder = this.classifyFolder(fromAddress, toAddresses, ccAddresses);
    const { mailCode, references } = this.extractCodes(bodyText, emailDate);
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

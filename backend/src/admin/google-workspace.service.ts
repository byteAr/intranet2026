import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { google } from 'googleapis';
import * as fs from 'fs';

@Injectable()
export class GoogleWorkspaceService {
  private readonly logger = new Logger(GoogleWorkspaceService.name);

  constructor(private readonly configService: ConfigService) {}

  private get isConfigured(): boolean {
    return !!(
      this.configService.get('GOOGLE_SERVICE_ACCOUNT_PATH') &&
      this.configService.get('GOOGLE_WORKSPACE_ADMIN_EMAIL')
    );
  }

  private getAdminClient() {
    const keyPath = this.configService.get<string>('GOOGLE_SERVICE_ACCOUNT_PATH')!;
    const adminEmail = this.configService.get<string>('GOOGLE_WORKSPACE_ADMIN_EMAIL')!;

    const key = JSON.parse(fs.readFileSync(keyPath, 'utf-8')) as {
      client_email: string;
      private_key: string;
    };

    const auth = new google.auth.JWT({
      email: key.client_email,
      key: key.private_key,
      scopes: ['https://www.googleapis.com/auth/admin.directory.user'],
      subject: adminEmail,
    });

    return google.admin({ version: 'directory_v1', auth });
  }

  async createUser(params: {
    username: string;
    firstName: string;
    lastName: string;
    password: string;
    recoveryEmail?: string;
    recoveryPhone?: string;
  }): Promise<void> {
    if (!this.isConfigured) {
      throw new Error('Google Workspace no está configurado. No se puede crear un usuario sin cuenta @iugna.edu.ar.');
    }

    const domain = this.configService.get<string>('GOOGLE_WORKSPACE_DOMAIN') ?? 'iugna.edu.ar';
    const primaryEmail = `${params.username}@${domain}`;
    const admin = this.getAdminClient();

    try {
      await admin.users.insert({
        requestBody: {
          primaryEmail,
          name: {
            givenName: params.firstName,
            familyName: params.lastName,
          },
          password: params.password,
          changePasswordAtNextLogin: true,
          ...(params.recoveryEmail ? { recoveryEmail: params.recoveryEmail } : {}),
          ...(params.recoveryPhone ? { recoveryPhone: params.recoveryPhone } : {}),
        },
      });
      this.logger.log('Cuenta Google Workspace creada: %s', primaryEmail);
    } catch (err: any) {
      if (err?.code === 409) {
        this.logger.warn('Cuenta Google Workspace ya existe, se continúa: %s', primaryEmail);
        return;
      }
      throw err;
    }
  }

  async deleteUser(username: string): Promise<void> {
    if (!this.isConfigured) return;

    const domain = this.configService.get<string>('GOOGLE_WORKSPACE_DOMAIN') ?? 'iugna.edu.ar';
    const primaryEmail = `${username}@${domain}`;

    try {
      const admin = this.getAdminClient();
      await admin.users.delete({ userKey: primaryEmail });
      this.logger.log('Cuenta Google Workspace eliminada: %s', primaryEmail);
    } catch (err) {
      this.logger.warn('No se pudo eliminar la cuenta de Google Workspace %s: %s', primaryEmail, (err as Error).message);
    }
  }
}

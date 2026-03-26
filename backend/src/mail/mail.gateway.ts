import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Email } from './entities/email.entity';
import { ImapPollerService, IMailGateway } from './imap-poller.service';

interface AuthenticatedSocket extends Socket {
  data: {
    user: { sub: string; username: string; displayName?: string };
  };
}

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/mail',
})
export class MailGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, IMailGateway
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(MailGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly imapPoller: ImapPollerService,
  ) {}

  onModuleInit(): void {
    this.imapPoller.setGateway(this);
  }

  afterInit(server: Server): void {
    server.use((socket: AuthenticatedSocket, next) => {
      const token: string =
        (socket.handshake.auth as Record<string, string>)?.token ??
        (socket.handshake.headers?.authorization as string | undefined)?.replace('Bearer ', '');
      if (!token) return next(new Error('No token'));
      try {
        const payload = this.jwtService.verify<{
          sub: string;
          username: string;
          displayName?: string;
        }>(token, { secret: this.configService.get<string>('jwt.secret') });
        socket.data.user = payload;
        return next();
      } catch {
        return next(new Error('Invalid token'));
      }
    });
  }

  handleConnection(socket: AuthenticatedSocket): void {
    const userId = socket.data.user?.sub;
    if (!userId) {
      socket.disconnect();
      return;
    }
    socket.join(`user:${userId}`);
    this.logger.debug(`Mail WS connected: ${userId}`);
  }

  handleDisconnect(socket: AuthenticatedSocket): void {
    this.logger.debug(`Mail WS disconnected: ${socket.data.user?.sub}`);
  }

  /** Called by ImapPollerService when a new email arrives. */
  notifyNewEmail(email: Email): void {
    this.server.emit('new_email', {
      id: email.id,
      subject: email.subject,
      from: email.fromAddress,
      folder: email.folder,
      date: email.date,
      mailCode: email.mailCode,
    });
  }
}

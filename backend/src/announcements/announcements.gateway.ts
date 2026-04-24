import { WebSocketGateway, WebSocketServer, OnGatewayInit } from '@nestjs/websockets';
import { Injectable } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

interface AuthSocket extends Socket {
  data: { user: { sub: string; username: string; displayName?: string } };
}

@Injectable()
@WebSocketGateway({ cors: { origin: '*' }, namespace: '/announcements' })
export class AnnouncementsGateway implements OnGatewayInit {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  afterInit(server: Server) {
    server.use((socket: AuthSocket, next) => {
      const token: string =
        (socket.handshake.auth as Record<string, string>)?.token ??
        (socket.handshake.headers?.authorization as string | undefined)?.replace('Bearer ', '');
      if (!token) return next(new Error('No token'));
      try {
        socket.data.user = this.jwtService.verify(token, {
          secret: this.configService.get<string>('jwt.secret'),
        });
        return next();
      } catch {
        return next(new Error('Invalid token'));
      }
    });
  }

  broadcast(message: string, senderName: string): void {
    this.server.emit('announcement', {
      message,
      senderName,
      sentAt: new Date().toISOString(),
    });
  }
}

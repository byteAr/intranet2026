import { OnGatewayConnection, OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import { extractSocketToken, scheduleSocketExpiry } from '../common/utils/socket-token.util';

interface AuthSocket extends Socket {
  data: { user: { sub: string; username: string } };
}

const room = (username: string) => `user:${username.toLowerCase()}`;

/** Entrega en vivo las notificaciones de la campanita; cada usuario escucha su sala. */
@Injectable()
@WebSocketGateway({ cors: { origin: '*' }, namespace: '/notifications' })
export class NotificationsGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  afterInit(server: Server) {
    server.use((socket: AuthSocket, next) => {
      const token = extractSocketToken(socket);
      if (!token) return next(new Error('No token'));
      try {
        const payload = this.jwtService.verify(token, { secret: this.configService.get<string>('jwt.secret') });
        socket.data.user = payload;
        scheduleSocketExpiry(socket, payload.exp);
        return next();
      } catch {
        return next(new Error('Invalid token'));
      }
    });
  }

  handleConnection(socket: AuthSocket) {
    const username = socket.data.user?.username;
    if (!username) {
      socket.disconnect();
      return;
    }
    void socket.join(room(username));
  }

  toUser(username: string, payload: unknown): void {
    this.server.to(room(username)).emit('notification', payload);
  }
}

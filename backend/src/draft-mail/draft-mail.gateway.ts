import { WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

interface AuthSocket extends Socket {
  data: { user: { sub: string; username: string; roles?: string[] } };
}

@WebSocketGateway({ cors: { origin: '*' }, namespace: '/draft-mail' })
export class DraftMailGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(DraftMailGateway.name);

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
        const payload = this.jwtService.verify(token, { secret: this.configService.get<string>('jwt.secret') });
        socket.data.user = payload;
        socket.join(`user:${payload.sub}`);
        return next();
      } catch {
        return next(new Error('Invalid token'));
      }
    });
  }

  handleConnection(socket: AuthSocket) {
    this.logger.debug(`Draft-mail WS connected: ${socket.data.user?.sub}`);
  }

  handleDisconnect(socket: AuthSocket) {
    this.logger.debug(`Draft-mail WS disconnected`);
  }

  notifyUser(userId: string, event: string, payload: unknown) {
    this.server.to(`user:${userId}`).emit(event, payload);
  }

  notifyRole(role: string, event: string, payload: unknown) {
    // Emit to all connected clients - frontend filters by role
    this.server.emit(event, payload);
  }
}

import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import { Incident } from './entities/incident.entity';

interface AuthenticatedSocket extends Socket {
  data: {
    user: { sub: string; username: string; displayName?: string };
  };
}

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/incidents',
})
export class IncidentsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  /** userId → socketIds */
  private userSockets = new Map<string, Set<string>>();

  /** TICOM user IDs currently connected */
  private ticomUserIds = new Set<string>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {}

  afterInit(server: Server) {
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

  async handleConnection(socket: AuthenticatedSocket) {
    const userId = socket.data.user?.sub;
    if (!userId) {
      socket.disconnect();
      return;
    }

    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, new Set());
    }
    this.userSockets.get(userId)!.add(socket.id);

    // Check if this user is TICOM
    const user = await this.usersService.findById(userId);
    if (user?.roles?.includes('TICOM')) {
      this.ticomUserIds.add(userId);
      socket.join('ticom');
    }

    // Also join a personal room for targeted notifications
    socket.join(`user:${userId}`);
  }

  handleDisconnect(socket: AuthenticatedSocket) {
    const userId = socket.data.user?.sub;
    if (!userId) return;
    const sockets = this.userSockets.get(userId);
    if (sockets) {
      sockets.delete(socket.id);
      if (sockets.size === 0) {
        this.userSockets.delete(userId);
        this.ticomUserIds.delete(userId);
      }
    }
  }

  /** Notify all TICOM members + the creator of a new incident */
  notifyNewIncident(incident: Incident): void {
    this.server.to('ticom').emit('incident:new', incident);
    this.server.to(`user:${incident.creatorId}`).emit('incident:new', incident);
  }

  /** Notify TICOM members + the creator when an incident is updated */
  notifyIncidentUpdate(incident: Incident): void {
    this.server.to('ticom').emit('incident:updated', incident);
    this.server.to(`user:${incident.creatorId}`).emit('incident:updated', incident);
  }
}

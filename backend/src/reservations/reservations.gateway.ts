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
import { Reservation } from './entities/reservation.entity';

interface AuthenticatedSocket extends Socket {
  data: {
    user: { sub: string; username: string; displayName?: string };
  };
}

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/reservations',
})
export class ReservationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private userSockets = new Map<string, Set<string>>();

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

    const user = await this.usersService.findById(userId);
    if (user?.roles?.includes('TICOM')) {
      socket.join('ticom');
    }
    if (user?.roles?.includes('AYUDANTIA')) {
      socket.join('ayudantia');
    }
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
      }
    }
  }

  notifyNewReservation(reservation: Reservation): void {
    this.server.to('ticom').emit('reservation:new', reservation);
    this.server.to(`user:${reservation.creatorId}`).emit('reservation:new', reservation);
    // Notify AYUDANTIA for piso_8 reservations
    if (reservation.location === 'piso_8') {
      this.server.to('ayudantia').emit('reservation:new', reservation);
    }
  }

  notifyReservationUpdate(reservation: Reservation): void {
    this.server.to('ticom').emit('reservation:updated', reservation);
    this.server.to(`user:${reservation.creatorId}`).emit('reservation:updated', reservation);
    if (reservation.location === 'piso_8') {
      this.server.to('ayudantia').emit('reservation:updated', reservation);
    }
  }
}

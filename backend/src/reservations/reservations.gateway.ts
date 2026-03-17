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
    const roles: string[] = user?.roles ?? [];
    if (roles.includes('TICOM')) {
      socket.join('ticom');
    }
    // Backward compat: old generic 'AYUDANTIA' role maps to ayudantiadiredtos (piso_8)
    if (roles.includes('AYUDANTIADIREDTOS') || roles.includes('AYUDANTIA')) {
      socket.join('ayudantiadiredtos');
    }
    if (roles.includes('AYUDANTIARECTORADO')) {
      socket.join('ayudantiarectorado');
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

  /** New reservation created — notify the creator, the relevant AYUDANTIA group, and TICOM */
  notifyNewReservation(reservation: Reservation): void {
    this.server.to(`user:${reservation.creatorId}`).emit('reservation:new', reservation);
    if (reservation.location === 'piso_8') {
      this.server.to('ayudantiadiredtos').emit('reservation:new', reservation);
    } else {
      this.server.to('ayudantiarectorado').emit('reservation:new', reservation);
    }
    this.server.to('ticom').emit('reservation:new', reservation);
  }

  /** Reservation updated (approved, rejected, confirmed, or edited) — notify relevant parties */
  notifyReservationUpdate(reservation: Reservation): void {
    // Always notify creator
    this.server.to(`user:${reservation.creatorId}`).emit('reservation:updated', reservation);

    // Always notify TICOM (they oversee all reservations at every stage)
    this.server.to('ticom').emit('reservation:updated', reservation);

    // Notify the responsible AYUDANTIA group (for their own record view)
    if (reservation.location === 'piso_8') {
      this.server.to('ayudantiadiredtos').emit('reservation:updated', reservation);
    } else {
      this.server.to('ayudantiarectorado').emit('reservation:updated', reservation);
    }
  }
}

import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ChatService } from './chat.service';
import { UsersService } from '../users/users.service';
import { PushService } from '../push/push.service';

interface AuthenticatedSocket extends Socket {
  data: {
    user: { sub: string; username: string; displayName?: string };
  };
}

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/chat',
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  /** userId → { socketIds, displayName, avatar } */
  private presence = new Map<string, { socketIds: Set<string>; displayName: string; avatar?: string }>();

  /** socketId → visible (Page Visibility API) */
  private socketVisibility = new Map<string, boolean>();

  constructor(
    private readonly chatService: ChatService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly pushService: PushService,
  ) {}

  // ─── Auth middleware ──────────────────────────────────────────────────────

  afterInit(server: Server) {
    server.use((socket: AuthenticatedSocket, next) => {
      const token: string =
        (socket.handshake.auth as Record<string, string>)?.token ??
        (socket.handshake.headers?.authorization as string | undefined)?.replace('Bearer ', '');
      if (!token) {
        console.warn('[Chat] socket rejected: no token', socket.id);
        return next(new Error('No token'));
      }
      try {
        const payload = this.jwtService.verify<{
          sub: string;
          username: string;
          displayName?: string;
        }>(token, { secret: this.configService.get<string>('jwt.secret') });
        socket.data.user = payload;
        console.log('[Chat] socket auth ok:', payload.username, socket.id);
        return next();
      } catch (err) {
        console.warn('[Chat] socket rejected: invalid token', socket.id, err);
        return next(new Error('Invalid token'));
      }
    });
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  async handleConnection(socket: AuthenticatedSocket) {
    const userId = socket.data.user?.sub;
    console.log('[Chat] handleConnection', socket.id, 'userId=', userId);
    if (!userId) {
      socket.disconnect();
      return;
    }
    const displayName = socket.data.user.displayName ?? socket.data.user.username;
    if (!this.presence.has(userId)) {
      // Load avatar from DB (not from JWT to avoid oversized tokens)
      const user = await this.usersService.findById(userId);
      const avatar = user?.avatar ?? undefined;
      this.presence.set(userId, { socketIds: new Set(), displayName, avatar });
    }
    this.presence.get(userId)!.socketIds.add(socket.id);

    this.broadcastPresence();
    console.log('[Chat] presence now:', Array.from(this.presence.keys()));

    try {
      // Run all initial queries in parallel for faster load
      const [unreadSummary, history, contactIds, lastMessages] = await Promise.all([
        this.chatService.getUnreadSummary(userId),
        this.chatService.getHistory(userId),
        this.chatService.getContactIds(userId),
        this.chatService.getLastDmMessages(userId),
      ]);

      // Send unread summary so badge shows immediately on login
      if (Object.keys(unreadSummary).length > 0) {
        socket.emit('unread:summary', unreadSummary);
      }

      // Send global history
      socket.emit('messages:history', { recipientId: null, messages: history });

      // Send current names/avatars for all contacts (avoids stale senderName in messages)
      if (contactIds.length > 0) {
        const users = await Promise.all(contactIds.map((id) => this.usersService.findById(id)));
        const contacts = users
          .filter((u): u is NonNullable<typeof u> => u !== null)
          .map((u) => ({
            id: u.id,
            displayName:
              [u.firstName, u.lastName].filter(Boolean).join(' ') ||
              u.displayName ||
              u.username,
            avatar: u.avatar ?? undefined,
          }));
        socket.emit('contacts:names', contacts);
      }

      // Send last DM message per conversation for sidebar previews
      if (Object.keys(lastMessages).length > 0) {
        socket.emit('conversations:lastMessages', lastMessages);
      }
    } catch (err) {
      console.error('[Chat] connection setup error for', userId, err);
    }
  }

  handleDisconnect(socket: AuthenticatedSocket) {
    const userId = socket.data.user?.sub;
    console.log('[Chat] handleDisconnect', socket.id, 'userId=', userId);
    if (!userId) return;
    const userData = this.presence.get(userId);
    if (userData) {
      userData.socketIds.delete(socket.id);
      if (userData.socketIds.size === 0) this.presence.delete(userId);
    }
    this.socketVisibility.delete(socket.id);
    this.broadcastPresence();
    console.log('[Chat] presence now:', Array.from(this.presence.keys()));
  }

  // ─── Events ───────────────────────────────────────────────────────────────

  @SubscribeMessage('visibility')
  handleVisibility(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { visible: boolean },
  ) {
    this.socketVisibility.set(socket.id, data.visible);
  }

  private isUserVisible(userId: string): boolean {
    const userData = this.presence.get(userId);
    if (!userData) return false;
    for (const socketId of userData.socketIds) {
      if (this.socketVisibility.get(socketId) === true) return true;
    }
    return false;
  }

  @SubscribeMessage('message:send')
  async handleSend(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: {
      content: string;
      recipientId?: string;
      attachmentUrl?: string;
      attachmentName?: string;
      attachmentSize?: number;
      attachmentMimeType?: string;
    },
  ) {
    const user = socket.data.user;
    const msg = await this.chatService.saveMessage({
      senderId: user.sub,
      senderName: user.displayName ?? user.username,
      senderAvatar: this.presence.get(user.sub)?.avatar,
      recipientId: data.recipientId,
      content: data.content,
      attachmentUrl: data.attachmentUrl,
      attachmentName: data.attachmentName,
      attachmentSize: data.attachmentSize,
      attachmentMimeType: data.attachmentMimeType,
    });

    if (data.recipientId) {
      // DM: emit to recipient sockets + sender sockets
      this.emitToUser(data.recipientId, 'message:new', msg);
      this.emitToUser(user.sub, 'message:new', msg);

      // Push solo si el destinatario no tiene la app visible
      if (!this.isUserVisible(data.recipientId)) {
        const senderName = user.displayName ?? user.username;
        const preview = data.content
          ? data.content.length > 60 ? data.content.slice(0, 60) + '…' : data.content
          : '📎 Archivo adjunto';
        const senderHasAvatar = !!this.presence.get(user.sub)?.avatar;
        void this.pushService.sendToUser(data.recipientId, {
          title: senderName,
          body: preview,
          icon: senderHasAvatar ? `/api/users/${user.sub}/avatar` : '/icons/icon-192x192.png',
          data: { onActionClick: { default: { operation: 'openWindow', url: '/chat' } } },
        });
      }
    } else {
      // Global broadcast
      this.server.emit('message:new', msg);
    }
  }

  @SubscribeMessage('message:markRead')
  async handleMarkRead(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { messageId: string },
  ) {
    await this.chatService.markRead(data.messageId, socket.data.user.sub);
  }

  @SubscribeMessage('messages:history')
  async handleHistory(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { recipientId?: string },
  ) {
    const history = await this.chatService.getHistory(
      socket.data.user.sub,
      data.recipientId,
    );
    socket.emit('messages:history', { recipientId: data.recipientId ?? null, messages: history });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private broadcastPresence() {
    const onlineUsers = Array.from(this.presence.entries()).map(([id, data]) => ({
      id,
      displayName: data.displayName,
      avatar: data.avatar,
    }));
    this.server.emit('presence:update', onlineUsers);
  }

  private emitToUser(userId: string, event: string, data: unknown) {
    const userData = this.presence.get(userId);
    if (!userData) return;
    userData.socketIds.forEach((id) => this.server.to(id).emit(event, data));
  }
}

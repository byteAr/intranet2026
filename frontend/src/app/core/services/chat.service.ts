import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { io, Socket } from 'socket.io-client';
import { AuthService } from './auth.service';

export interface UserSearchResult {
  id: string | null;
  displayName: string;
  username: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  avatar?: string;
  fromLdap?: boolean;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  recipientId?: string | null;
  content: string;
  attachmentUrl?: string;
  attachmentName?: string;
  attachmentSize?: number;
  attachmentMimeType?: string;
  readBy: string[];
  createdAt: string;
}

export interface OnlineUser {
  id: string;
  displayName: string;
  avatar?: string;
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly authService = inject(AuthService);
  private readonly http = inject(HttpClient);
  private socket: Socket | null = null;

  readonly onlineUsers = signal<OnlineUser[]>([]);
  readonly userNames = signal<Record<string, string>>({});
  readonly userAvatars = signal<Record<string, string>>({});
  readonly messages = signal<ChatMessage[]>([]);

  /** IDs of users with whom the current user has actual conversation history */
  readonly conversationContactIds = signal<Set<string>>(new Set());

  /** Unread count per conversation key: userId for DMs, 'global' for the global chat */
  readonly unreadCounts = signal<Record<string, number>>({});

  /** Total unread count across DM conversations only (used for nav badge) */
  readonly unreadCount = computed(() =>
    Object.entries(this.unreadCounts())
      .filter(([key]) => key !== 'global')
      .reduce((sum, [, n]) => sum + n, 0),
  );

  readonly activeRecipientId = signal<string | null>(null);
  readonly isChatOpen = signal<boolean>(false);

  /** Last message per conversation key (userId for DMs) */
  readonly lastMessages = signal<Record<string, ChatMessage>>({});

  readonly loadingHistory = signal<boolean>(false);

  constructor() {
    // Disconnect synchronously when the user logs out
    this.authService.onBeforeLogout(() => this.disconnect());
  }

  connect(): void {
    // If socket exists but is disconnected (server rejected or network error), recreate it
    if (this.socket && !this.socket.connected) {
      this.socket.removeAllListeners();
      this.socket = null;
    }
    if (this.socket) return;
    const token = this.authService.getToken();
    if (!token) return;

    this.socket = io('/chat', {
      auth: { token },
      transports: ['websocket', 'polling'],
    });

    this.socket.on('presence:update', (users: OnlineUser[]) => {
      this.onlineUsers.set(users);
      const names = { ...this.userNames() };
      const avatars = { ...this.userAvatars() };
      users.forEach((u) => {
        names[u.id] = u.displayName;
        if (u.avatar) avatars[u.id] = u.avatar;
      });
      this.userNames.set(names);
      this.userAvatars.set(avatars);
    });

    this.socket.on('contacts:names', (contacts: Array<{ id: string; displayName: string; avatar?: string }>) => {
      const names = { ...this.userNames() };
      const avatars = { ...this.userAvatars() };
      contacts.forEach((c) => {
        names[c.id] = c.displayName;
        if (c.avatar) avatars[c.id] = c.avatar;
      });
      this.userNames.set(names);
      this.userAvatars.set(avatars);
      // Track users with real conversation history
      this.conversationContactIds.update((ids) => {
        const next = new Set(ids);
        contacts.forEach((c) => next.add(c.id));
        return next;
      });
    });

    this.socket.on('conversations:lastMessages', (data: Record<string, ChatMessage>) => {
      this.lastMessages.update((lm) => ({ ...data, ...lm }));
    });

    this.socket.on('unread:summary', (summary: Record<string, number>) => {
      console.log('[ChatService] unread:summary received', summary);
      this.unreadCounts.update((counts) => ({ ...counts, ...summary }));
    });

    this.socket.on('message:new', (msg: ChatMessage) => {
      const recipientId = this.activeRecipientId();
      const currentUserId = this.authService.currentUser()?.id;

      // Track last message per conversation
      if (msg.recipientId) {
        const key = msg.senderId === currentUserId ? msg.recipientId : msg.senderId;
        this.lastMessages.update((lm) => ({ ...lm, [key]: msg }));
      }

      // Cache sender name/avatar from incoming messages
      if (msg.senderId !== currentUserId) {
        const names = { ...this.userNames() };
        names[msg.senderId] = msg.senderName;
        this.userNames.set(names);
        if (msg.senderAvatar) {
          const avatars = { ...this.userAvatars() };
          avatars[msg.senderId] = msg.senderAvatar;
          this.userAvatars.set(avatars);
        }
        // Track as conversation contact (received DM or global message)
        if (msg.recipientId) {
          this.conversationContactIds.update((ids) => new Set([...ids, msg.senderId]));
        }
      } else if (msg.recipientId) {
        // I sent a DM — track the recipient as conversation contact
        this.conversationContactIds.update((ids) => new Set([...ids, msg.recipientId!]));
      }

      const belongsToThread =
        recipientId === null
          ? !msg.recipientId
          : (msg.senderId === recipientId && msg.recipientId === currentUserId) ||
            (msg.senderId === currentUserId && msg.recipientId === recipientId);

      const isViewing = this.isChatOpen() && belongsToThread;

      if (isViewing) {
        this.messages.update((msgs) => [...msgs, msg]);
        if (msg.senderId !== currentUserId) {
          this.markRead(msg.id);
        }
      } else if (
        msg.senderId !== currentUserId &&
        (!msg.recipientId || msg.recipientId === currentUserId)
      ) {
        // Track unread per conversation
        const key = msg.recipientId ? msg.senderId : 'global';
        this.unreadCounts.update((counts) => ({
          ...counts,
          [key]: (counts[key] ?? 0) + 1,
        }));
      }
    });

    this.socket.on('messages:history', (payload: any) => {
      // Support both old (array) and new ({ recipientId, messages }) format
      const msgs: ChatMessage[] = Array.isArray(payload) ? payload : (payload?.messages ?? []);
      const recipientId: string | null = Array.isArray(payload) ? null : (payload?.recipientId ?? null);
      const currentUserId = this.authService.currentUser()?.id;

      // Populate userNames/userAvatars from history so offline contacts stay visible
      if (msgs.length > 0) {
        const names = { ...this.userNames() };
        const avatars = { ...this.userAvatars() };
        const newContactIds = new Set<string>();
        msgs.forEach((m) => {
          if (m.senderId !== currentUserId) {
            names[m.senderId] = m.senderName;
            if (m.senderAvatar) avatars[m.senderId] = m.senderAvatar;
            if (m.recipientId) newContactIds.add(m.senderId);
          } else if (m.recipientId) {
            newContactIds.add(m.recipientId);
          }
        });
        this.userNames.set(names);
        this.userAvatars.set(avatars);
        if (newContactIds.size > 0) {
          this.conversationContactIds.update((ids) => new Set([...ids, ...newContactIds]));
        }

        // Update last message preview for DM conversations
        const lastMsg = msgs[msgs.length - 1];
        if (lastMsg.recipientId) {
          const key = lastMsg.senderId === currentUserId ? lastMsg.recipientId : lastMsg.senderId;
          this.lastMessages.update((lm) => ({ ...lm, [key]: lastMsg }));
        }
      }

      if (this.isChatOpen()) {
        // Only apply messages to the view if this response matches the active conversation
        if (recipientId !== this.activeRecipientId()) return;
        this.loadingHistory.set(false);
        this.messages.set(msgs);
        msgs.forEach((m) => {
          if (m.senderId !== currentUserId && !m.readBy.includes(currentUserId ?? '')) {
            this.markRead(m.id);
          }
        });
      } else {
        // Not viewing chat: count unread per conversation for the badge
        const newCounts: Record<string, number> = {};
        msgs.forEach((m) => {
          if (
            m.senderId !== currentUserId &&
            !m.readBy.includes(currentUserId ?? '') &&
            (!m.recipientId || m.recipientId === currentUserId)
          ) {
            const key = m.recipientId ? m.senderId : 'global';
            newCounts[key] = (newCounts[key] ?? 0) + 1;
          }
        });
        if (Object.keys(newCounts).length > 0) {
          this.unreadCounts.update((counts) => {
            const updated = { ...counts };
            Object.entries(newCounts).forEach(([key, n]) => {
              updated[key] = (updated[key] ?? 0) + n;
            });
            return updated;
          });
        }
      }
    });
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.onlineUsers.set([]);
    this.userNames.set({});
    this.userAvatars.set({});
    this.messages.set([]);
    this.unreadCounts.set({});
    this.conversationContactIds.set(new Set());
    this.lastMessages.set({});
    this.loadingHistory.set(false);
  }

  sendMessage(content: string, recipientId?: string, attachment?: { url: string; name: string; size: number; mimeType: string }): void {
    this.socket?.emit('message:send', {
      content,
      recipientId: recipientId ?? null,
      attachmentUrl: attachment?.url,
      attachmentName: attachment?.name,
      attachmentSize: attachment?.size,
      attachmentMimeType: attachment?.mimeType,
    });
  }

  uploadFile(file: File): Observable<{ url: string; name: string; size: number; mimeType: string }> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<{ url: string; name: string; size: number; mimeType: string }>('/api/chat/upload', form);
  }

  loadHistory(recipientId?: string | null): void {
    this.messages.set([]);
    this.loadingHistory.set(true);
    this.socket?.emit('messages:history', { recipientId: recipientId ?? null });
  }

  markRead(messageId: string): void {
    this.socket?.emit('message:markRead', { messageId });
  }

  selectConversation(recipientId: string | null): void {
    this.activeRecipientId.set(recipientId);
    this.loadHistory(recipientId);
    // Clear only this conversation's unread count
    const key = recipientId ?? 'global';
    this.unreadCounts.update((counts) => {
      const updated = { ...counts };
      delete updated[key];
      return updated;
    });
  }

  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  searchUsers(query: string): Observable<UserSearchResult[]> {
    return this.http.get<UserSearchResult[]>(`/api/users/search?q=${encodeURIComponent(query)}`);
  }

  ensureUser(user: UserSearchResult): Observable<{ id: string; displayName: string; avatar?: string }> {
    return this.http.post<{ id: string; displayName: string; avatar?: string }>('/api/users/ensure', {
      username: user.username,
      displayName: user.displayName,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
    });
  }
}

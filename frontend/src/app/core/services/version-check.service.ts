import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class VersionCheckService {
  private currentVersion: string | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  readonly updateAvailable = signal(false);

  start(): void {
    this.fetchVersion().then((v) => {
      this.currentVersion = v;
    });
    this.intervalId = setInterval(() => this.check(), 5 * 60 * 1000);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  reload(): void {
    window.location.reload();
  }

  private async check(): Promise<void> {
    const v = await this.fetchVersion();
    if (v && this.currentVersion && v !== this.currentVersion) {
      this.updateAvailable.set(true);
    }
  }

  private async fetchVersion(): Promise<string | null> {
    try {
      const res = await fetch(`/version.json?t=${Date.now()}`);
      if (!res.ok) return null;
      const data = await res.json();
      return data?.v ?? null;
    } catch {
      return null;
    }
  }
}

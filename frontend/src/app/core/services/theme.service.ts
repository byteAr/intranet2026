import { Injectable, signal, effect } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly isDark = signal<boolean>(
    typeof localStorage !== 'undefined' && localStorage.getItem('theme') === 'dark'
  );

  constructor() {
    document.documentElement.classList.toggle('dark', this.isDark());
    effect(() => {
      document.documentElement.classList.toggle('dark', this.isDark());
      localStorage.setItem('theme', this.isDark() ? 'dark' : 'light');
    });
  }

  toggle(): void {
    this.isDark.update(v => !v);
  }
}

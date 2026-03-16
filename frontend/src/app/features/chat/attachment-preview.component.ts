import {
  Component,
  Input,
  OnInit,
  AfterViewChecked,
  ElementRef,
  ViewChild,
  ChangeDetectorRef,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { lastValueFrom } from 'rxjs';

@Component({
  selector: 'app-attachment-preview',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div style="height:180px; overflow:hidden; position:relative; background:#e5e7eb; display:flex; align-items:center; justify-content:center;">
      @if (state === 'loading') {
        <svg style="width:20px;height:20px;color:#9ca3af;animation:spin 1s linear infinite" fill="none" viewBox="0 0 24 24">
          <circle style="opacity:.25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
          <path style="opacity:.75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
        </svg>
      } @else if (state === 'error') {
        <span style="font-size:11px;color:#9ca3af;">Vista previa no disponible</span>
      } @else if (state === 'pdf') {
        <canvas #pdfCanvas style="width:100%;display:block;position:absolute;top:0;left:0;"></canvas>
      } @else if (state === 'html') {
        <div style="width:100%;height:100%;overflow:hidden;padding:6px;box-sizing:border-box;pointer-events:none;position:absolute;top:0;left:0;background:#fff;">
          <div [innerHTML]="safeHtml" style="font-size:8px;line-height:1.3;transform-origin:top left;overflow:hidden;max-height:180px;"></div>
        </div>
      }
    </div>
  `,
  styles: [`:host { display:block; } @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`],
})
export class AttachmentPreviewComponent implements OnInit, AfterViewChecked {
  @Input() url!: string;
  @Input() mimeType = '';

  @ViewChild('pdfCanvas') canvasRef?: ElementRef<HTMLCanvasElement>;

  state: 'loading' | 'pdf' | 'html' | 'error' = 'loading';
  safeHtml: SafeHtml = '';

  private pendingBuf: ArrayBuffer | null = null;
  private rendered = false;

  constructor(
    private readonly http: HttpClient,
    private readonly sanitizer: DomSanitizer,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void { void this.load(); }

  ngAfterViewChecked(): void {
    if (this.pendingBuf && this.canvasRef && !this.rendered) {
      this.rendered = true;
      void this.renderPdf(this.pendingBuf);
    }
  }

  private async load(): Promise<void> {
    try {
      const buf = await lastValueFrom(
        this.http.get(this.url, { responseType: 'arraybuffer' }),
      );

      if (this.mimeType === 'application/pdf') {
        this.pendingBuf = buf;
        this.state = 'pdf';
      } else if (this.mimeType.includes('word') || this.mimeType === 'application/msword') {
        await this.loadDocx(buf);
      } else if (this.mimeType.includes('spreadsheet') || this.mimeType.includes('excel') || this.mimeType === 'application/vnd.ms-excel') {
        await this.loadXlsx(buf);
      } else {
        this.state = 'error';
      }
    } catch (e) {
      console.error('[AttachmentPreview] load error:', e);
      this.state = 'error';
    }
    this.cdr.detectChanges();
  }

  private async renderPdf(buf: ArrayBuffer): Promise<void> {
    try {
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
      const page = await pdf.getPage(1);
      const canvas = this.canvasRef!.nativeElement;
      const w = canvas.parentElement?.clientWidth || 260;
      const vp0 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: w / vp0.width });
      canvas.width = vp.width;
      canvas.height = vp.height;
      await (page as any).render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    } catch (e) {
      console.error('[AttachmentPreview] pdf render error:', e);
      this.state = 'error';
      this.cdr.detectChanges();
    }
  }

  private async loadDocx(buf: ArrayBuffer): Promise<void> {
    try {
      const m = await import('mammoth') as any;
      const mammoth = m.default ?? m;
      const result = await mammoth.convertToHtml({ arrayBuffer: buf });
      const html = `<div style="font-family:sans-serif;font-size:10px;color:#111;padding:2px">${result.value}</div>`;
      this.safeHtml = this.sanitizer.bypassSecurityTrustHtml(html);
      this.state = 'html';
    } catch (e) {
      console.error('[AttachmentPreview] docx error:', e);
      this.state = 'error';
    }
  }

  private async loadXlsx(buf: ArrayBuffer): Promise<void> {
    try {
      const x = await import('xlsx') as any;
      const XLSX = x.default ?? x;
      const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      const tableRows = rows.slice(0, 20).map((row: any[]) =>
        `<tr>${row.map((cell: any) => `<td style="border:1px solid #ccc;padding:1px 3px;white-space:nowrap;font-size:9px;color:#111">${cell}</td>`).join('')}</tr>`
      ).join('');
      const html = `<table style="border-collapse:collapse;font-family:sans-serif">${tableRows}</table>`;
      this.safeHtml = this.sanitizer.bypassSecurityTrustHtml(html);
      this.state = 'html';
    } catch (e) {
      console.error('[AttachmentPreview] xlsx error:', e);
      this.state = 'error';
    }
  }
}

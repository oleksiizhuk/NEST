import { join } from 'path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resvg } from '@resvg/resvg-js';
import { IReplyImageRenderer } from '@application/telegram/reply-image.renderer.interface';

// Bundled by nest-cli into dist/assets — resvg silently renders nothing
// without a real TTF (woff/woff2 are not supported by its font backend)
const FONT_PATH = join(__dirname, '../../assets/fonts/NotoSans.ttf');
const FONT_FAMILY = 'Noto Sans';

// A wall of text makes a terrible picture — long replies stay plain text
const MAX_CHARS = 600;

const WIDTH = 900;
const PADDING = 56;
const FONT_SIZE = 30;
const LINE_HEIGHT = 44;
// Noto Sans averages ~0.55em per glyph; good enough for greedy wrapping
const CHARS_PER_LINE = Math.floor((WIDTH - PADDING * 2) / (FONT_SIZE * 0.55));

interface Theme {
  from: string;
  to: string;
  accent: string;
  text: string;
  // Repeating decoration painted over the gradient
  pattern: string;
}

const THEMES: Record<string, Theme> = {
  // Task created — cool, technical, blueprint grid
  jira: {
    from: '#0b1d3a',
    to: '#123a63',
    accent: '#4da3ff',
    text: '#e8f2ff',
    pattern:
      '<path d="M0 0 H60 M0 0 V60" stroke="#4da3ff" stroke-width="1" fill="none" opacity="0.18"/>',
  },
  // Begging for money — green, banknote-ish
  money: {
    from: '#0f2c1c',
    to: '#1d5136',
    accent: '#5ad18b',
    text: '#e9fff2',
    pattern:
      '<circle cx="30" cy="30" r="11" stroke="#5ad18b" stroke-width="1.5" fill="none" opacity="0.2"/>',
  },
  // Booze and Дед — neon night
  booze: {
    from: '#2a0f3d',
    to: '#5b1a4f',
    accent: '#ff77c8',
    text: '#ffeaf8',
    pattern:
      '<path d="M0 60 L60 0" stroke="#ff77c8" stroke-width="2" opacity="0.16"/>',
  },
  // Everything else — warm slate
  default: {
    from: '#1c1c22',
    to: '#33343d',
    accent: '#ffb454',
    text: '#f3f1ec',
    pattern: '<circle cx="20" cy="20" r="2" fill="#ffb454" opacity="0.22"/>',
  },
};

const THEME_KEYWORDS: [string, RegExp][] = [
  ['jira', /\b[A-Z]{2,10}-\d+\b|jira|browse\//i],
  ['booze', /нанюхер|пив[кео]|бухл|стакан|дед|мчик|самогон|наливай|тверез/i],
  ['money', /грн|гроші|позич|сижк|оліі?ю|олія|аванс|борг|копійк/i],
];

@Injectable()
export class ReplyImageRenderer implements IReplyImageRenderer {
  private readonly logger = new Logger(ReplyImageRenderer.name);
  private readonly enabled: boolean;

  constructor(configService: ConfigService) {
    this.enabled =
      configService.get<string>('TELEGRAM_IMAGE_REPLY') !== 'false';
  }

  async render(text: string): Promise<Buffer | null> {
    const clean = this.stripUnrenderable(text).trim();
    if (!this.enabled || !clean || clean.length > MAX_CHARS) return null;

    try {
      const lines = this.wrap(clean);
      const svg = this.buildSvg(lines, this.pickTheme(clean));
      return new Resvg(svg, {
        font: {
          fontFiles: [FONT_PATH],
          loadSystemFonts: false,
          defaultFontFamily: FONT_FAMILY,
        },
      })
        .render()
        .asPng();
    } catch (error) {
      // Never lose the reply over decoration — caller falls back to text
      this.logger.error(error);
      return null;
    }
  }

  private pickTheme(text: string): Theme {
    const match = THEME_KEYWORDS.find(([, pattern]) => pattern.test(text));
    return THEMES[match ? match[0] : 'default'];
  }

  // The bundled font has no emoji glyphs — they would render as tofu boxes
  private stripUnrenderable(text: string): string {
    return text
      .replace(
        /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu,
        '',
      )
      .replace(/[ \t]+/g, ' ');
  }

  private wrap(text: string): string[] {
    const lines: string[] = [];
    for (const paragraph of text.split('\n')) {
      if (!paragraph.trim()) {
        lines.push('');
        continue;
      }
      let current = '';
      for (const word of paragraph.trim().split(' ')) {
        if (current && current.length + word.length + 1 > CHARS_PER_LINE) {
          lines.push(current);
          current = word;
        } else {
          current = current ? `${current} ${word}` : word;
        }
      }
      if (current) lines.push(current);
    }
    return lines;
  }

  private buildSvg(lines: string[], theme: Theme): string {
    const height = PADDING * 2 + lines.length * LINE_HEIGHT;
    const tspans = lines
      .map(
        (line, i) =>
          `<tspan x="${PADDING + 18}" y="${
            PADDING + FONT_SIZE + i * LINE_HEIGHT
          }">${this.escape(line)}</tspan>`,
      )
      .join('');

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${theme.from}"/>
      <stop offset="100%" stop-color="${theme.to}"/>
    </linearGradient>
    <pattern id="deco" width="60" height="60" patternUnits="userSpaceOnUse">${
      theme.pattern
    }</pattern>
  </defs>
  <rect width="${WIDTH}" height="${height}" fill="url(#bg)"/>
  <rect width="${WIDTH}" height="${height}" fill="url(#deco)"/>
  <rect x="${PADDING - 14}" y="${PADDING - 10}" width="5" height="${
      height - (PADDING - 10) * 2
    }" rx="2.5" fill="${theme.accent}"/>
  <text font-family="${FONT_FAMILY}" font-size="${FONT_SIZE}" fill="${
      theme.text
    }">${tspans}</text>
</svg>`;
  }

  private escape(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}

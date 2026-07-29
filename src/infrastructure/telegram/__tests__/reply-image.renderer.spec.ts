import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { ReplyImageRenderer } from '@infrastructure/telegram/reply-image.renderer';

// PNG magic number — proves resvg actually produced a bitmap
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

const build = async (imageReply?: string): Promise<ReplyImageRenderer> => {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ReplyImageRenderer,
      {
        provide: ConfigService,
        useValue: { get: jest.fn().mockReturnValue(imageReply) },
      },
    ],
  }).compile();
  return module.get(ReplyImageRenderer);
};

describe('ReplyImageRenderer', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('renders a PNG for a normal reply', async () => {
    const renderer = await build();

    const png = await renderer.render('Слухай сюди, поки я тверезий');

    expect(png).toBeInstanceOf(Buffer);
    expect(png.subarray(0, 4)).toEqual(PNG_SIGNATURE);
  });

  it('picks a different theme per topic', async () => {
    const renderer = await build();

    const [jira, booze] = await Promise.all([
      renderer.render('Створив KAN-12'),
      renderer.render('Готуй стакани, нанюхеримось'),
    ]);

    // Same layout, different palette — the bytes must differ
    expect(jira).not.toEqual(booze);
  });

  it('skips rendering when disabled', async () => {
    const renderer = await build('false');

    await expect(renderer.render('будь-що')).resolves.toBeNull();
  });

  it('skips replies too long to read as a picture', async () => {
    const renderer = await build();

    await expect(renderer.render('а'.repeat(601))).resolves.toBeNull();
  });

  it('skips empty and emoji-only replies', async () => {
    const renderer = await build();

    await expect(renderer.render('   ')).resolves.toBeNull();
    await expect(renderer.render('😢😢')).resolves.toBeNull();
  });

  it('escapes XML so markup in a reply cannot break the SVG', async () => {
    const renderer = await build();

    const png = await renderer.render(
      '<script>alert(1)</script> & <b>жирно</b>',
    );

    expect(png.subarray(0, 4)).toEqual(PNG_SIGNATURE);
  });
});

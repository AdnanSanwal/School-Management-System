import { sniff, assertKind, signedUrl, verifySignature, readFile } from '../../utils/storage';

const PDF = Buffer.from('%PDF-1.4\n%…');
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
const EXE = Buffer.from('MZ\x90\x00 this is a windows executable');
const HTML = Buffer.from('<html><script>alert(1)</script></html>');

const KEY = '11111111-1111-1111-1111-111111111111/documents/22222222-2222-2222-2222-222222222222.pdf';

describe('file type sniffing', () => {
  it('recognises allowed formats by content', () => {
    expect([PDF, JPG, PNG, WEBP].map(sniff)).toEqual(['pdf', 'jpg', 'png', 'webp']);
  });

  it('rejects executables and HTML whatever they are called', () => {
    expect(sniff(EXE)).toBeNull();
    expect(sniff(HTML)).toBeNull();
    expect(() => assertKind(EXE, ['pdf'])).toThrow(expect.objectContaining({ statusCode: 415 }));
  });

  it('enforces the allowed list per use (photos are images only)', () => {
    expect(() => assertKind(PDF, ['jpg', 'png', 'webp'])).toThrow(expect.objectContaining({ statusCode: 415 }));
    expect(assertKind(PNG, ['jpg', 'png', 'webp'])).toBe('png');
  });

  it('rejects files over 5 MB', () => {
    const big = Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024)]);
    expect(() => assertKind(big, ['pdf'])).toThrow(expect.objectContaining({ statusCode: 413 }));
  });
});

describe('signed URLs', () => {
  const parse = (u: string) => {
    const url = new URL(u);
    return { key: url.pathname.replace('/api/v1/files/', ''), exp: url.searchParams.get('exp')!, sig: url.searchParams.get('sig')! };
  };

  it('verifies a fresh link', () => {
    const { key, exp, sig } = parse(signedUrl(KEY)!);
    expect(key).toBe(KEY);
    expect(verifySignature(key, exp, sig)).toBe(true);
  });

  it('rejects tampered key, expiry or signature', () => {
    const { key, exp, sig } = parse(signedUrl(KEY)!);
    const otherKey = KEY.replace('2222', '3333');
    expect(verifySignature(otherKey, exp, sig)).toBe(false);
    expect(verifySignature(key, String(Number(exp) + 1000), sig)).toBe(false);
    expect(verifySignature(key, exp, sig.slice(0, -2) + 'xx')).toBe(false);
    expect(verifySignature(key, exp, undefined)).toBe(false);
  });

  it('rejects expired links', () => {
    const { key, exp, sig } = parse(signedUrl(KEY, -10)!);
    expect(verifySignature(key, exp, sig)).toBe(false);
  });

  it('returns null for missing keys', () => {
    expect(signedUrl(null)).toBeNull();
  });
});

describe('path safety', () => {
  it.each([
    '../../.env',
    '11111111-1111-1111-1111-111111111111/../../../etc/passwd',
    '11111111-1111-1111-1111-111111111111/documents/../../x.pdf',
    '11111111-1111-1111-1111-111111111111/documents/evil.html',
  ])('refuses %s', async (k) => {
    await expect(readFile(k)).rejects.toMatchObject({ statusCode: 404 });
  });
});

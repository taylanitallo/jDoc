import { describe, it, expect } from 'vitest';
import { isSafePublicUrl, isPrivateOrReservedIp } from './url-guard';

describe('url-guard — isPrivateOrReservedIp (puro)', () => {
  it('classifica IPs privados/reservados', () => {
    expect(isPrivateOrReservedIp('93.184.216.34')).toBe(false); // publico
    expect(isPrivateOrReservedIp('10.1.2.3')).toBe(true);
    expect(isPrivateOrReservedIp('172.16.5.4')).toBe(true);
    expect(isPrivateOrReservedIp('192.168.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('127.0.0.1')).toBe(true);
    expect(isPrivateOrReservedIp('169.254.169.254')).toBe(true); // metadata
    expect(isPrivateOrReservedIp('::1')).toBe(true);
    expect(isPrivateOrReservedIp('fd00::1')).toBe(true);
    expect(isPrivateOrReservedIp('nao-e-ip')).toBe(true);
  });
});

describe('url-guard — isSafePublicUrl', () => {
  it('aceita https com IP publico', async () => {
    expect((await isSafePublicUrl('https://93.184.216.34/aia.cer')).safe).toBe(true);
  });

  it('rejeita http (nao-https)', async () => {
    expect((await isSafePublicUrl('http://example.com/aia.cer')).safe).toBe(false);
  });

  it('rejeita o endpoint de metadata 169.254.169.254', async () => {
    expect((await isSafePublicUrl('https://169.254.169.254/latest/meta-data/')).safe).toBe(false);
  });

  it('rejeita IP privado 10.x', async () => {
    expect((await isSafePublicUrl('https://10.0.0.5/x.cer')).safe).toBe(false);
  });

  it('rejeita localhost (resolve para loopback)', async () => {
    expect((await isSafePublicUrl('https://localhost/x.cer')).safe).toBe(false);
  });

  it('rejeita URL malformada', async () => {
    expect((await isSafePublicUrl('nao://://url')).safe).toBe(false);
  });
});

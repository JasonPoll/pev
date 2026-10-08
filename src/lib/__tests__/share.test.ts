import { describe, expect, it } from 'vitest';
import ordersJson from '../../samples/orders.json?raw';
import { buildImportUrl, gunzip, gzip, readImportParams } from '../share';

describe('plan links', () => {
  it('round-trips a plan, its query and its name through a link', async () => {
    const url = await buildImportUrl('https://tatiyants.com/pev/', { plan: ordersJson, query: 'SELECT 1', name: 'Orders & co' });
    expect(url).toMatch(/^https:\/\/tatiyants\.com\/pev\/#\/import\?name=Orders\+%26\+co&plan_gz=[\w-]+&query_gz=[\w-]+$/);
    expect(url.length).toBeLessThan(ordersJson.length / 4);

    const params = new URLSearchParams(url.split('?')[1]);
    expect(await readImportParams(params)).toEqual({ plan: ordersJson, query: 'SELECT 1', name: 'Orders & co' });
  });

  it('reads plain values', async () => {
    const params = new URLSearchParams({ plan: 'Result  (cost=0.00..0.01 rows=1 width=4)' });
    expect(await readImportParams(params)).toEqual({ plan: 'Result  (cost=0.00..0.01 rows=1 width=4)', query: '', name: '' });
  });

  it('reads what `gzip | base64` produces on the command line', async () => {
    // printf "SELECT 1;" | gzip -c | base64
    expect(await gunzip('H4sIAJghyGoAAwt29XF1DlEwtAYAXDOyBAkAAAA=\n')).toBe('SELECT 1;');
    expect(await gunzip(await gzip('ünïcode ✓'))).toBe('ünïcode ✓');
  });
});

import { describe, expect, it } from 'vitest';
import { highlightQuery } from '../highlight';

// text of each highlighted range; a range spanning several syntax tokens is split into several <mark>s
const marked = (html: string) => {
  const merged = html.replace(/<(?!\/?mark)[^>]+>/g, '').replace(/<\/mark><mark class="code-key-item">/g, '');
  return [...merged.matchAll(/<mark class="code-key-item">(.*?)<\/mark>/gs)].map((m) =>
    m[1].replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&'),
  );
};

describe('highlightQuery', () => {
  const query = `SELECT c.state, sum(o.totalamount)
FROM customers c
  INNER JOIN orders o ON c.customerid = o.customerid
WHERE o.totalamount > 10
GROUP BY c.state
LIMIT 10`;

  it('marks the relation a scan reads', () => {
    const html = highlightQuery(query, { 'Node Type': 'Seq Scan', 'Relation Name': 'customers', Schema: 'public', Alias: 'c' });
    expect(marked(html)).toEqual(['customers c']);
  });

  it('tells apart scans of the same table and ignores column aliases', () => {
    const sql = `WITH recent AS (SELECT * FROM orders o WHERE o.total > 0)
SELECT count(*) AS orders FROM recent r
WHERE r.total > (SELECT avg(total) FROM orders)`;
    expect(marked(highlightQuery(sql, { 'Node Type': 'Seq Scan', 'Relation Name': 'orders', Alias: 'o' }))).toEqual(['orders o']);
    expect(marked(highlightQuery(sql, { 'Node Type': 'Seq Scan', 'Relation Name': 'orders', Alias: 'orders' }))).toEqual([
      'orders',
    ]);
    expect(highlightQuery(sql, { 'Node Type': 'Seq Scan', 'Relation Name': 'orders', Alias: 'orders' })).toContain(
      'FROM</span> <mark class="code-key-item">orders</mark>)',
    );
  });

  it('marks join conditions written in either order, ignoring parentheses and casts', () => {
    const html = highlightQuery(query, { 'Node Type': 'Hash Join', 'Hash Cond': '(o.customerid = c.customerid)' });
    expect(marked(html)).toEqual(['c.customerid = o.customerid']);

    const filter = highlightQuery(query, { 'Node Type': 'Seq Scan', Filter: '((o.totalamount)::numeric > 10::numeric)' });
    expect(marked(filter)).toEqual(['o.totalamount > 10']);
  });

  it('marks group keys and limits', () => {
    expect(marked(highlightQuery(query, { 'Node Type': 'Aggregate', 'Group Key': ['c.state'] }))).toEqual([
      'c.state',
      'GROUP BY c.state',
    ]);
    expect(marked(highlightQuery(query, { 'Node Type': 'Limit' }))).toEqual(['LIMIT 10']);
  });

  it('keeps the query text intact', () => {
    const html = highlightQuery(query, { 'Node Type': 'Hash Join', 'Hash Cond': '(o.customerid = c.customerid)' });
    const div = document.createElement('div');
    div.innerHTML = html;
    expect(div.textContent).toBe(query);
  });
});

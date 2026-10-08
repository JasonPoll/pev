import { filteredFraction } from '../../lib/nodes';
import type { AnalyzedNode } from '../../lib/types';

const TAG_CLASS: Record<string, string> = {
  slowest: 'tag hot',
  'spills to disk': 'tag warn',
  'bad estimate': 'tag warn',
};

export function NodeTags({ node, limit }: { node: AnalyzedNode; limit?: number }) {
  const tags: string[] = [...node.tags];
  const filtered = filteredFraction(node);
  if (filtered !== undefined && filtered >= 0.5) tags.push(`${Math.round(filtered * 100)}% filtered`);
  if (!tags.length) return null;

  return (
    <span className="node-tags">
      {tags.slice(0, limit).map((tag) => (
        <span key={tag} className={TAG_CLASS[tag] ?? 'tag'}>
          {tag}
        </span>
      ))}
    </span>
  );
}

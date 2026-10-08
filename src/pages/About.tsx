export function About() {
  return (
    <div className="page">
      <div className="prose">
      <h1>Postgres EXPLAIN Visualizer (pev)</h1>
      <p>
        Pev is designed to make{' '}
        <a href="https://www.postgresql.org/docs/current/sql-explain.html">Postgres query plans</a> easier to grok. It
        displays a plan as a tree, with each node representing a step that takes in a row set and produces another. Pev
        can show you a number of useful things:
      </p>
      <ul>
        <li>overall plan stats, including buffers, JIT and trigger time</li>
        <li>individual node stats (duration, rows, cost, buffers)</li>
        <li>explanation of what each node does</li>
        <li>outlier nodes, bad planner estimates and nodes that spill to disk</li>
        <li>graph of a specific metric (like cost) for all nodes, as a tree, a flame chart or an outline</li>
        <li>plain-language findings, like filters that throw away most rows or hashes that spill to disk</li>
        <li>for some nodes, highlighted part of the query which corresponds to the node</li>
      </ul>

      <p>Switch between the tree, flame and outline views, and pick the metric to graph, from the controls at the top.</p>

      <h2>Usage tips</h2>
      <p>
        Pev accepts plans in both JSON and text format. To get the most out of it, I recommend generating a query plan
        using the following line: <code>EXPLAIN (ANALYZE, COSTS, VERBOSE, BUFFERS, SETTINGS, FORMAT JSON)</code>. I also
        recommend submitting a (decently formatted) SQL query that generated the plan. Doing so will make Pev more
        useful.
      </p>
      <p>
        Pev understands parallel query (Gather nodes and their workers), CTEs, InitPlans and SubPlans. Durations shown on
        each node are <em>exclusive</em>: they don't include time spent in the node's children, and account for loops and
        parallel workers.
      </p>

      <p>
        You can also paste a plan straight from an <code>auto_explain</code> log entry (pev picks up the query from it),
        or open a plan from a link: the link icon next to a plan's name copies one. The plan travels in the part of the
        link after the <code>#</code>, which browsers never send to a server.
      </p>

      <p>
        Pev will remember the plans you analyzed. They are stored locally and are not submitted to me. This is good
        because no one but you will see your queries. It's also bad because you can't share them with others.
      </p>

      <h2>Acknowledgements</h2>
      <p>
        Pev was inspired and heavily influenced by the excellent <a href="https://explain.depesz.com/">explain.depesz.com</a>.
        Both the tool and the corresponding help files are a great resource to learn about Postgres and its planner.
      </p>

      <h2>Help me improve Pev</h2>
      <p>If you want to help, there are multiple ways to contribute:</p>
      <ul>
        <li>give me your plans - I need more test cases for the layout</li>
        <li>add descriptions for missing node types</li>
        <li>
          contribute to the code on <a href="https://github.com/AlexTatiyants/pev">github</a>
        </li>
      </ul>
      </div>
    </div>
  );
}

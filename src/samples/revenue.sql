WITH recent_orders AS MATERIALIZED (
  SELECT o.orderid, o.customerid, o.totalamount
  FROM orders o
  WHERE o.orderdate >= date '2024-01-01'
)
SELECT c.state,
  count(*) AS orders,
  sum(r.totalamount) AS revenue
FROM recent_orders r
  INNER JOIN customers c ON c.customerid = r.customerid
WHERE r.totalamount > (SELECT avg(totalamount) FROM orders)
GROUP BY c.state
ORDER BY revenue DESC
LIMIT 10

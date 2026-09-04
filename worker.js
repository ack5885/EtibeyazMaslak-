export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/order-number") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", {
          status: 405,
          headers: { "Allow": "POST" },
        });
      }

      if (!env.ORDER_DB) {
        return Response.json(
          { ok: false, error: "ORDER_DB binding missing" },
          { status: 500 }
        );
      }

      try {
        const row = await env.ORDER_DB
          .prepare("INSERT INTO order_numbers DEFAULT VALUES RETURNING id")
          .first();

        if (!row || row.id == null) {
          throw new Error("D1 did not return an order id");
        }

        const id = Number(row.id);
        const orderNo = `EB-${String(id).padStart(4, "0")}`;

        return Response.json(
          { ok: true, orderNo, id },
          {
            headers: {
              "Cache-Control": "no-store, no-cache, must-revalidate",
            },
          }
        );
      } catch (error) {
        console.error("Order counter error", error);
        return Response.json(
          { ok: false, error: "Sipariş numarası oluşturulamadı" },
          { status: 500 }
        );
      }
    }

    return env.ASSETS.fetch(request);
  },
};

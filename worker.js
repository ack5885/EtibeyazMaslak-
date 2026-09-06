
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (env.ORDER_DB) {
      await env.ORDER_DB.prepare(`
        CREATE TABLE IF NOT EXISTS customers (
          phone TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          part TEXT,
          street TEXT,
          no TEXT,
          company TEXT,
          stamps INTEGER NOT NULL DEFAULT 0,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `).run();
    }

    if (url.pathname === "/api/customer") {
      if (!env.ORDER_DB) {
        return Response.json({ ok:false, error:"ORDER_DB binding missing" }, { status:500 });
      }

      if (request.method === "GET") {
        const phone = (url.searchParams.get("phone") || "").replace(/\D/g,"").slice(-10);
        if (!phone) return Response.json({ok:false,error:"Telefon gerekli"},{status:400});
        const row = await env.ORDER_DB.prepare(
          "SELECT phone,name,part,street,no,company,stamps FROM customers WHERE phone=?"
        ).bind(phone).first();
        if (!row) return Response.json({ok:true,customer:null,stamps:0});
        return Response.json({ok:true,customer:row,stamps:Number(row.stamps||0)});
      }

      if (request.method === "POST") {
        const body = await request.json();
        const phone = String(body.phone||"").replace(/\D/g,"").slice(-10);
        const name = String(body.name||"").trim();
        if (!phone || !name) return Response.json({ok:false,error:"Ad ve telefon gerekli"},{status:400});

        await env.ORDER_DB.prepare(`
          INSERT INTO customers(phone,name,part,street,no,company,stamps,updated_at)
          VALUES(?,?,?,?,?,?,0,CURRENT_TIMESTAMP)
          ON CONFLICT(phone) DO UPDATE SET
            name=excluded.name,
            part=excluded.part,
            street=excluded.street,
            no=excluded.no,
            company=excluded.company,
            updated_at=CURRENT_TIMESTAMP
        `).bind(
          phone, name,
          String(body.part||""), String(body.street||""),
          String(body.no||""), String(body.company||"")
        ).run();

        const row = await env.ORDER_DB.prepare(
          "SELECT phone,name,part,street,no,company,stamps FROM customers WHERE phone=?"
        ).bind(phone).first();

        return Response.json({ok:true,customer:row,stamps:Number(row.stamps||0)});
      }

      return new Response("Method Not Allowed",{status:405});
    }

    if (url.pathname === "/api/add-stamp") {
      if (request.method !== "POST") return new Response("Method Not Allowed",{status:405});
      if (!env.ORDER_DB) return Response.json({ok:false,error:"ORDER_DB binding missing"},{status:500});

      const body = await request.json();
      const phone = String(body.phone||"").replace(/\D/g,"").slice(-10);
      if (!phone) return Response.json({ok:false,error:"Telefon gerekli"},{status:400});

      const row = await env.ORDER_DB.prepare(`
        UPDATE customers
        SET stamps = stamps + 1, updated_at=CURRENT_TIMESTAMP
        WHERE phone=?
        RETURNING stamps
      `).bind(phone).first();

      if (!row) return Response.json({ok:false,error:"Müşteri bulunamadı"},{status:404});
      return Response.json({ok:true,stamps:Number(row.stamps)});
    }

    if (url.pathname === "/api/order-number") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405, headers: { "Allow": "POST" } });
      }
      if (!env.ORDER_DB) {
        return Response.json({ ok:false, error:"ORDER_DB binding missing" }, { status:500 });
      }

      const row = await env.ORDER_DB
        .prepare("INSERT INTO order_numbers DEFAULT VALUES RETURNING id")
        .first();

      const id = Number(row.id);
      const orderNo = `EB-${String(id).padStart(4, "0")}`;
      return Response.json({ ok:true, orderNo, id }, { headers:{ "Cache-Control":"no-store" } });
    }

    return env.ASSETS.fetch(request);
  }
};

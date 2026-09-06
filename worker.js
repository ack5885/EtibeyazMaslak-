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

      await env.ORDER_DB.prepare(`
        CREATE TABLE IF NOT EXISTS order_bijons (
          order_id INTEGER PRIMARY KEY,
          phone TEXT NOT NULL,
          awarded INTEGER NOT NULL DEFAULT 0,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          awarded_at TEXT
        )
      `).run();

      await env.ORDER_DB.prepare(`
        CREATE TABLE IF NOT EXISTS reward_uses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          phone TEXT NOT NULL,
          reward TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
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
      return Response.json({ok:false,error:"Bijon yalnızca sipariş üzerinden eklenebilir."},{status:403});
    }


    if (url.pathname === "/api/redeem-reward") {
      if (request.method !== "POST") return new Response("Method Not Allowed",{status:405});
      if (!env.ORDER_DB) return Response.json({ok:false,error:"ORDER_DB binding missing"},{status:500});

      let body = {};
      try { body = await request.json(); } catch (_) {}
      const phone = String(body.phone || "").replace(/\D/g,"").slice(-10);
      if (!phone) return Response.json({ok:false,error:"Telefon gerekli"},{status:400});

      const row = await env.ORDER_DB.prepare(`
        UPDATE customers
        SET stamps = stamps - 5, updated_at=CURRENT_TIMESTAMP
        WHERE phone=? AND stamps >= 5
        RETURNING stamps
      `).bind(phone).first();

      if (!row) return Response.json({ok:false,error:"Hediye için 5 bijon gerekli"},{status:400});

      await env.ORDER_DB.prepare(
        "INSERT INTO reward_uses(phone,reward) VALUES(?,?)"
      ).bind(phone,"Usta İşi Dürüm + Ayran").run();

      return Response.json({
        ok:true,
        stamps:Number(row.stamps),
        reward:"Usta İşi Dürüm + Ayran"
      },{headers:{"Cache-Control":"no-store"}});
    }

    if (url.pathname === "/api/order-number") {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405, headers: { "Allow": "POST" } });
      }
      if (!env.ORDER_DB) {
        return Response.json({ ok:false, error:"ORDER_DB binding missing" }, { status:500 });
      }

      let body = {};
      try { body = await request.json(); } catch (_) {}
      const phone = String(body.phone || "").replace(/\D/g,"").slice(-10);

      const row = await env.ORDER_DB
        .prepare("INSERT INTO order_numbers DEFAULT VALUES RETURNING id")
        .first();

      const id = Number(row.id);
      const orderNo = `EB-${String(id).padStart(4, "0")}`;
      let stamps = null;

      if (phone) {
        const customer = await env.ORDER_DB.prepare(
          "SELECT phone, stamps FROM customers WHERE phone=?"
        ).bind(phone).first();

        if (customer) {
          await env.ORDER_DB.prepare(
            "INSERT OR IGNORE INTO order_bijons(order_id,phone,awarded) VALUES(?,?,0)"
          ).bind(id, phone).run();

          const award = await env.ORDER_DB.prepare(`
            UPDATE order_bijons
            SET awarded=1, awarded_at=CURRENT_TIMESTAMP
            WHERE order_id=? AND awarded=0
            RETURNING order_id
          `).bind(id).first();

          if (award) {
            await env.ORDER_DB.prepare(`
              UPDATE customers
              SET stamps = CASE WHEN stamps < 5 THEN stamps + 1 ELSE 5 END,
                  updated_at=CURRENT_TIMESTAMP
              WHERE phone=?
            `).bind(phone).run();
          }

          const c = await env.ORDER_DB.prepare(
            "SELECT stamps FROM customers WHERE phone=?"
          ).bind(phone).first();

          stamps = Number(c?.stamps || 0);
        }
      }

      return Response.json(
        { ok:true, orderNo, id, stamps },
        { headers:{ "Cache-Control":"no-store" } }
      );
    }

    return env.ASSETS.fetch(request);
  }
};

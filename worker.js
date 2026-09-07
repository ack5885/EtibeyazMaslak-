
function json(data, status=200){
  return Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
}
function normPhone(v){
  return String(v||"").replace(/\D/g,"").slice(-10);
}
async function ensureSchema(env){
  if(!env.ORDER_DB) return;

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
    CREATE TABLE IF NOT EXISTS order_numbers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
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

  await env.ORDER_DB.prepare(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY,
      order_no TEXT UNIQUE NOT NULL,
      phone TEXT NOT NULL,
      customer_name TEXT,
      order_type TEXT,
      ready_time TEXT,
      payment TEXT,
      part TEXT,
      street TEXT,
      door_no TEXT,
      note TEXT,
      total INTEGER NOT NULL DEFAULT 0,
      items_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'Yeni',
      is_reward INTEGER NOT NULL DEFAULT 0,
      reward_name TEXT,
      bijon_awarded INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      delivered_at TEXT
    )
  `).run();
}

async function requireAdmin(request, env){
  let expected = "";
  try {
    if (env.USTA_PIN && typeof env.USTA_PIN.get === "function") {
      expected = String(await env.USTA_PIN.get() || "");
    } else {
      expected = String(env.USTA_PIN || "");
    }
  } catch (_) {
    expected = "";
  }
  const got = request.headers.get("x-usta-pin") || "";
  return !!expected && got === expected;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    await ensureSchema(env);

    if (url.pathname === "/api/customer") {
      if (!env.ORDER_DB) return json({ok:false,error:"ORDER_DB binding missing"},500);

      if (request.method === "GET") {
        const phone = normPhone(url.searchParams.get("phone"));
        if (!phone) return json({ok:false,error:"Telefon gerekli"},400);
        const row = await env.ORDER_DB.prepare(
          "SELECT phone,name,part,street,no,company,stamps FROM customers WHERE phone=?"
        ).bind(phone).first();
        if (!row) return json({ok:true,customer:null,stamps:0});
        return json({ok:true,customer:row,stamps:Number(row.stamps||0)});
      }

      if (request.method === "POST") {
        const body = await request.json();
        const phone = normPhone(body.phone);
        const name = String(body.name||"").trim();
        if (!phone || !name) return json({ok:false,error:"Ad ve telefon gerekli"},400);

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
          phone,name,String(body.part||""),String(body.street||""),
          String(body.no||""),String(body.company||"")
        ).run();

        const row = await env.ORDER_DB.prepare(
          "SELECT phone,name,part,street,no,company,stamps FROM customers WHERE phone=?"
        ).bind(phone).first();

        return json({ok:true,customer:row,stamps:Number(row.stamps||0)});
      }

      return new Response("Method Not Allowed",{status:405});
    }

    if (url.pathname === "/api/add-stamp") {
      return json({ok:false,error:"Bijon yalnızca Teslim Edildi onayından sonra eklenebilir."},403);
    }

    if (url.pathname === "/api/orders" && request.method === "POST") {
      if (!env.ORDER_DB) return json({ok:false,error:"ORDER_DB binding missing"},500);

      let body={};
      try{ body=await request.json(); }catch(_){}
      const phone=normPhone(body.phone);
      const name=String(body.name||"").trim();
      const items=Array.isArray(body.items)?body.items:[];
      if(!phone || !name || !items.length) return json({ok:false,error:"Eksik sipariş bilgisi"},400);

      const n = await env.ORDER_DB.prepare(
        "INSERT INTO order_numbers DEFAULT VALUES RETURNING id"
      ).first();
      const id=Number(n.id);
      const orderNo=`EB-${String(id).padStart(4,"0")}`;

      await env.ORDER_DB.prepare(`
        INSERT INTO orders(
          id,order_no,phone,customer_name,order_type,ready_time,payment,
          part,street,door_no,note,total,items_json,status,is_reward,bijon_awarded
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'Yeni',0,0)
      `).bind(
        id,orderNo,phone,name,String(body.order_type||""),
        String(body.ready_time||""),String(body.payment||""),
        String(body.part||""),String(body.street||""),String(body.door_no||""),
        String(body.note||""),Number(body.total||0),JSON.stringify(items)
      ).run();

      const c=await env.ORDER_DB.prepare("SELECT stamps FROM customers WHERE phone=?").bind(phone).first();
      return json({ok:true,orderNo,id,status:"Yeni",stamps:Number(c?.stamps||0)});
    }

    // Backward compatibility: only number creation, no bijon.
    if (url.pathname === "/api/order-number" && request.method === "POST") {
      const n = await env.ORDER_DB.prepare(
        "INSERT INTO order_numbers DEFAULT VALUES RETURNING id"
      ).first();
      const id=Number(n.id);
      return json({ok:true,orderNo:`EB-${String(id).padStart(4,"0")}`,id});
    }

    if (url.pathname === "/api/redeem-reward") {
      if (request.method !== "POST") return new Response("Method Not Allowed",{status:405});
      if (!env.ORDER_DB) return json({ok:false,error:"ORDER_DB binding missing"},500);

      let body={};
      try{ body=await request.json(); }catch(_){}
      const phone=normPhone(body.phone);
      if(!phone) return json({ok:false,error:"Telefon gerekli"},400);

      const customer=await env.ORDER_DB.prepare(
        "SELECT phone,name,stamps FROM customers WHERE phone=?"
      ).bind(phone).first();
      if(!customer || Number(customer.stamps)<5){
        return json({ok:false,error:"Hediye için 5 bijon gerekli"},400);
      }

      const n=await env.ORDER_DB.prepare(
        "INSERT INTO order_numbers DEFAULT VALUES RETURNING id"
      ).first();
      const id=Number(n.id);
      const orderNo=`EB-${String(id).padStart(4,"0")}`;

      const updated=await env.ORDER_DB.prepare(`
        UPDATE customers
        SET stamps=stamps-5,updated_at=CURRENT_TIMESTAMP
        WHERE phone=? AND stamps>=5
        RETURNING stamps
      `).bind(phone).first();
      if(!updated) return json({ok:false,error:"Hediye kullanılamadı"},409);

      await env.ORDER_DB.prepare(
        "INSERT INTO reward_uses(phone,reward) VALUES(?,?)"
      ).bind(phone,"Usta İşi Dürüm + Ayran").run();

      const rewardItems=[{
        campaign_id:0,
        campaign:"5 Bijon Hediyesi",
        description:"Usta İşi Dürüm + Ayran",
        quantity:1,
        unit_price:0,
        line_total:0
      }];

      await env.ORDER_DB.prepare(`
        INSERT INTO orders(
          id,order_no,phone,customer_name,order_type,ready_time,payment,
          part,street,door_no,note,total,items_json,status,is_reward,reward_name,bijon_awarded
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'Yeni',1,?,1)
      `).bind(
        id,orderNo,phone,String(customer.name||""),"Hediye","Mümkün olan en kısa sürede",
        "Hediye","","","","5 Bijon Hediyesi",0,JSON.stringify(rewardItems),"Usta İşi Dürüm + Ayran"
      ).run();

      return json({
        ok:true,
        stamps:Number(updated.stamps||0),
        reward:"Usta İşi Dürüm + Ayran",
        orderNo
      });
    }

    if (url.pathname === "/api/admin/orders") {
      if(!(await requireAdmin(request,env))) return json({ok:false,error:"Yetkisiz"},401);
      if(request.method!=="GET") return new Response("Method Not Allowed",{status:405});

      const status=url.searchParams.get("status")||"";
      let rows;
      if(status){
        const r=await env.ORDER_DB.prepare(`
          SELECT * FROM orders WHERE status=? ORDER BY id DESC LIMIT 100
        `).bind(status).all();
        rows=r.results||[];
      }else{
        const r=await env.ORDER_DB.prepare(`
          SELECT * FROM orders ORDER BY id DESC LIMIT 100
        `).all();
        rows=r.results||[];
      }

      rows=rows.map(r=>({
        ...r,
        total:Number(r.total||0),
        is_reward:Number(r.is_reward||0),
        bijon_awarded:Number(r.bijon_awarded||0),
        items:(()=>{try{return JSON.parse(r.items_json||"[]")}catch(_){return[]}})()
      }));
      return json({ok:true,orders:rows});
    }

    const statusMatch=url.pathname.match(/^\/api\/admin\/orders\/(\d+)\/status$/);
    if(statusMatch){
      if(!(await requireAdmin(request,env))) return json({ok:false,error:"Yetkisiz"},401);
      if(request.method!=="POST") return new Response("Method Not Allowed",{status:405});

      const id=Number(statusMatch[1]);
      let body={};
      try{body=await request.json()}catch(_){}
      const next=String(body.status||"");
      const allowed=["Yeni","Hazırlanıyor","Hazır","Teslim Edildi","İptal"];
      if(!allowed.includes(next)) return json({ok:false,error:"Geçersiz durum"},400);

      const order=await env.ORDER_DB.prepare("SELECT * FROM orders WHERE id=?").bind(id).first();
      if(!order) return json({ok:false,error:"Sipariş bulunamadı"},404);

      if(next==="Teslim Edildi" && Number(order.is_reward)===0 && Number(order.bijon_awarded)===0){
        await env.ORDER_DB.prepare(
          "INSERT OR IGNORE INTO order_bijons(order_id,phone,awarded) VALUES(?,?,0)"
        ).bind(id,order.phone).run();

        const lock=await env.ORDER_DB.prepare(`
          UPDATE order_bijons
          SET awarded=1,awarded_at=CURRENT_TIMESTAMP
          WHERE order_id=? AND awarded=0
          RETURNING order_id
        `).bind(id).first();

        if(lock){
          await env.ORDER_DB.prepare(`
            UPDATE customers
            SET stamps=CASE WHEN stamps<5 THEN stamps+1 ELSE 5 END,
                updated_at=CURRENT_TIMESTAMP
            WHERE phone=?
          `).bind(order.phone).run();

          await env.ORDER_DB.prepare(
            "UPDATE orders SET bijon_awarded=1 WHERE id=?"
          ).bind(id).run();
        }
      }

      await env.ORDER_DB.prepare(`
        UPDATE orders
        SET status=?,updated_at=CURRENT_TIMESTAMP,
            delivered_at=CASE WHEN ?='Teslim Edildi' THEN CURRENT_TIMESTAMP ELSE delivered_at END
        WHERE id=?
      `).bind(next,next,id).run();

      const fresh=await env.ORDER_DB.prepare("SELECT * FROM orders WHERE id=?").bind(id).first();
      const c=await env.ORDER_DB.prepare("SELECT stamps FROM customers WHERE phone=?").bind(order.phone).first();

      return json({ok:true,order:fresh,stamps:Number(c?.stamps||0)});
    }

    if (url.pathname === "/api/admin/stats") {
      if(!(await requireAdmin(request,env))) return json({ok:false,error:"Yetkisiz"},401);
      const total=await env.ORDER_DB.prepare("SELECT COUNT(*) c FROM orders").first();
      const open=await env.ORDER_DB.prepare(
        "SELECT COUNT(*) c FROM orders WHERE status NOT IN ('Teslim Edildi','İptal')"
      ).first();
      const delivered=await env.ORDER_DB.prepare(
        "SELECT COUNT(*) c FROM orders WHERE status='Teslim Edildi'"
      ).first();
      return json({
        ok:true,
        total:Number(total?.c||0),
        open:Number(open?.c||0),
        delivered:Number(delivered?.c||0)
      });
    }

    return env.ASSETS.fetch(request);
  }
};

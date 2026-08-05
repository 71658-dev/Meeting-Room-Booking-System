export default {                                                                                                                                                                           
      async fetch(request, env, ctx) {                                                                                                                                                         
        const url = new URL(request.url);                                                                                                                                                      
                                                                                                                                                                                               
        // 1. 取得所有資料 API (GET /api/data)                                                                                                                                                 
        if (url.pathname === '/api/data' && request.method === 'GET') {                                                                                                                        
          const dataStr = await env.MEETING_DB.get('all_app_data');                                                                                                                            
          return new Response(dataStr || '{}', {                                                                                                                                               
            headers: { 'content-type': 'application/json;charset=UTF-8' }                                                                                                                      
          });                                                                                                                                                                                  
        }                                                                                                                                                                                      
                                                                                                                                                                                               
        // 2. 儲存所有資料 API (POST /api/data)                                                                                                                                                
        if (url.pathname === '/api/data' && request.method === 'POST') {                                                                                                                       
          try {                                                                                                                                                                                
            const body = await request.text();                                                                                                                                                 
            // 將全部狀態寫入 Cloudflare KV                                                                                                                                                    
            await env.MEETING_DB.put('all_app_data', body);                                                                                                                                    
            return new Response(JSON.stringify({ success: true }), {                                                                                                                           
              headers: { 'content-type': 'application/json' }                                                                                                                                  
            });                                                                                                                                                                                
          } catch (err) {                                                                                                                                                                      
            return new Response(JSON.stringify({ error: err.message }), { status: 500 });                                                                                                      
          }                                                                                                                                                                                    
        }                                                                                                                                                                                      
                                                                                                                                                                                               
        // 預設由 Cloudflare Assets 回傳 static files (例如 index.html)                                                                                                                        
        return env.ASSETS.fetch(request);                                                                                                                                                      
      }                                                                                                                                                                                        
    };
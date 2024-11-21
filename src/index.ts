/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.toml`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

interface Env {
	PROXY_DOMAIN: string;
	PROXY_URL: string;
	ZLIBRARY_DOMAIN: string;
}

export default {
	async fetch(request, env: Env, ctx): Promise<Response> {
		const targetUrl = new URL(request.url);
		targetUrl.port = '443';
		targetUrl.hostname = env.ZLIBRARY_DOMAIN;
		targetUrl.protocol = "https:";

		// 获取原始请求头
		const headers = new Headers(request.headers);
		// 获取并修改 Cookie 头
		const cookies = headers.get("cookie");
		if (cookies) {
			const modifiedCookies = cookies
				.split(";") // 将 cookies 按照分号分开
				.map((cookie) => {
					return cookie.trim().replace(/(domain=[^;]*)/i, `domain=${env.ZLIBRARY_DOMAIN}`);
				})
				.join("; "); // 重新拼接为单一字符串

			// 设置修改后的 Cookie 头
			headers.set("cookie", modifiedCookies);
		}

		// 重写请求
		const modifiedRequest = new Request(targetUrl, {
			method: request.method,
			headers: request.headers,
			body: request.body,
			redirect: "manual", // 避免自动重定向
		});

		try {
			// 发起到目标站点的请求
			const response = await fetch(modifiedRequest);

			const filterUrls = ['.woff', '.woff2', '.ttf', '.jpg', '.png', '.svg', '.ico']

			for (let filterUrl of filterUrls) {
				if (request.url.indexOf(filterUrl) > -1) {
					return response;
				}
			}

			const newResponseHeaders = new Headers(response.headers);
			// 修改 Location 头
			if (newResponseHeaders.has("location")) {
				const location = newResponseHeaders.get("location");
				if (location !== null && location.includes(env.ZLIBRARY_DOMAIN)) {
					newResponseHeaders.set(
						"location",
						env.PROXY_URL
					);
				}
			}

			// 修改 Set-Cookie 头
			const responseCookies = newResponseHeaders.getAll("set-cookie");
			if (responseCookies.length > 0) {
				newResponseHeaders.delete("set-cookie");
				const reg = new RegExp(env.ZLIBRARY_DOMAIN, 'ig');

				responseCookies.forEach((cookie) => {
					const updatedCookie = cookie.replace(reg, env.PROXY_DOMAIN);
					newResponseHeaders.append("set-cookie", updatedCookie);
				});
			}

			// 检查是否为 302 重定向
			if (response.status === 302) {
				// 返回自定义的 302 响应
				return new Response(null, {
					status: 302,
					headers: newResponseHeaders
				});
			}

			// 读取并修改响应的 body
			const responseBody = await response.text(); // 将 body 读取为文本
			const modifiedBody = responseBody.replace(
				new RegExp(`https:((\/\/)|(\\\/\\\/))([a-zA-Z-]+\.)?${env.ZLIBRARY_DOMAIN.replaceAll('.', '\.')}`, 'ig'),
				env.PROXY_URL
			).replace(new RegExp(env.ZLIBRARY_DOMAIN, 'ig'), env.PROXY_DOMAIN);

			// 创建一个新的响应对象
			const modifiedResponse = new Response(modifiedBody, {
				status: response.status,
				statusText: response.statusText,
				headers: newResponseHeaders, // 修改headers
			});

			return modifiedResponse;
		} catch (error) {
			return new Response("Error occurred while proxying", {
				status: 500,
				headers: { "Content-Type": "text/plain" },
			});
		}
	}
} satisfies ExportedHandler<Env>;

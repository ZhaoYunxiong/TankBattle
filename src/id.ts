// 局域网 HTTP 的部分浏览器没有 randomUUID，保留随机字节回退。
export const uniqueId = () => crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');

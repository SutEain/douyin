# **使用说明：**  
## 一、详细使用方法
## **BiliBili、虎牙、斗鱼、YY实时M3U获取：**
### BiliBili生活：
```
http://你的IP:35455/bililive.m3u
如果你的allinone服务被部署至服务器上，并且使用https域名反代了IP+端口，那么你的链接要变成：
https://你的反代域名/bililive.m3u(?url=https://你的反代域名)   举个例子：https://www.feiyang.com/bililive.m3u?url=https://www.feiyang.com
括号中为可选参数，用来方便替换列表前缀为https的，如果反代域名中含有特殊符号的，先去urlencode，如果反代后的域名依旧存在端口，那就把端口照样加上去，比如url=https://feiyang.com:12345，不加url参数默认是http协议
```
### 虎牙一起看：
```
http://你的IP:35455/huyayqk.m3u
如果你的allinone服务被部署至服务器上，并且使用https域名反代了IP+端口，那么你的链接要变成：
https://你的反代域名/huyayqk.m3u(?url=https://你的反代域名)   举个例子：https://www.feiyang.com/huyayqk.m3u?url=https://www.feiyang.com
括号中为可选参数，用来方便替换列表前缀为https的，如果反代域名中含有特殊符号的，先去urlencode，如果反代后的域名依旧存在端口，那就把端口照样加上去，比如url=https://feiyang.com:12345，不加url参数默认是http协议
```
### 斗鱼一起看：
```
http://你的IP:35455/douyuyqk.m3u
如果你的allinone服务被部署至服务器上，并且使用https域名反代了IP+端口，那么你的链接要变成：
https://你的反代域名/douyuyqk.m3u(?url=https://你的反代域名)   举个例子：https://www.feiyang.com/douyuyqk.m3u?url=https://www.feiyang.com
括号中为可选参数，用来方便替换列表前缀为https的，如果反代域名中含有特殊符号的，先去urlencode，如果反代后的域名依旧存在端口，那就把端口照样加上去，比如url=https://feiyang.com:12345，不加url参数默认是http协议
```
### YY轮播：
```
http://你的IP:35455/yylunbo.m3u
如果你的allinone服务被部署至服务器上，并且使用https域名反代了IP+端口，那么你的链接要变成：
https://你的反代域名/yylunbo.m3u(?url=https://你的反代域名)   举个例子：https://www.feiyang.com/yylunbo.m3u?url=https://www.feiyang.com
括号中为可选参数，用来方便替换列表前缀为https的，如果反代域名中含有特殊符号的，先去urlencode，如果反代后的域名依旧存在端口，那就把端口照样加上去，比如url=https://feiyang.com:12345，不加url参数默认是http协议
```
## **抖音：**
### 默认最高画质，（可选flv和hls两种种流媒体传输方式，默认flv）：
```
1，通过douyin用户uid获取，比如douyinXX全能王的uid是keyis153
http://你的IP:35455/douyin/uid/keyis153(?stream=hls)
2，通过douyin房间rid获取，比如douyinXX全能王的房间rid是https://live.douyin.com/921169302662中的921169302662
http://你的IP:35455/douyin/rid/921169302662(?stream=hls)
```
## **斗鱼：**
### 1，可选m3u8和flv以及xs三种流媒体传输方式【`(www.douyu.com/)xxxxxx 或 (www.douyu.com/xx/xx?rid=)xxxxxx`，默认flv】：
```
http://你的IP:35455/douyu/xxxxx(?stream=flv)
```
## **BiliBili`(live.bilibili.com/)xxxxxx`：**
### 1，平台platform参数选择（默认web，如果有问题，可以切换h5平台）：
```
"flv"   => "FLV"
"hls"    => "M3U8"
```
### 2，线路line参数选择（默认线路二，如果卡顿/看不了，请切换线路一或者三，一般直播间只会提供两条线路，所以建议线路一/二之间切换）：
```
"first"  => "线路一"
"second" => "线路二"
"third"  => "线路三"
```
### 3，画质quality参数选择（默认原画，可以看什么画质去直播间看看，能选什么画质就能加什么参数，参数错误一定不能播放）：
```
"4" => "原画质"
"3" => "低画质"
```
### 4，最后的代理链接示例：
```
http://你的IP:35455/bilibili/xxxxxx(?platform=hls&line=first&quality=4)
```
## **虎牙`(huya.com/)xxxxxx`：**  
### 1，查看可用CDN：
```
http://你的IP:35455/huya/xxxxx?type=json
```
### 2，切换媒体类型（默认flv，可选flv、hls）： 
```
http://你的IP:35455/huya/xxxxx?media=hls
```
### 3，切换CDN（默认hwcdn，可选hycdn、alicdn、txcdn、hwcdn、hscdn、wscdn，具体可先访问1获取）：
```
http://你的IP:35455/huya/xxxxx?cdn=alicdn
```
### 4，最后的代理链接示例：
```
http://你的IP:35455/huya/xxxxx(?media=xxx&cdn=xxx)
```
## **YY（默认最高画质，参数为4）:**
```
https://www.yy.com/xxxx
http://你的IP:35455/yy/xxxx(?quality=1/2/3/4...)
```
## 更多平台后续会酌情添加
# 免责声明：本程序仅供学习交流，源码均搜集自互联网，禁止使用其谋取利益或者进行不正当行为，禁止在大陆自媒体平台分享本程序，否则本程序不背任何责任，如有侵权请联系，将会直接下架移除本程序！

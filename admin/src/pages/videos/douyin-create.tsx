import { Card, Space, Button, Form, Input, Image, message } from 'antd'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabaseClient } from '../../supabaseClient'

type ParseResult = {
  source_url: string
  aweme_id?: string | null
  description?: string | null
  play_url: string
  cover_url?: string | null
  duration?: number | null
  width?: number | null
  height?: number | null
  cdn_url_expired?: number | null
}

export const VideoDouyinCreate = () => {
  const navigate = useNavigate()
  const [rawText, setRawText] = useState('')
  const [loadingParse, setLoadingParse] = useState(false)
  const [loadingSave, setLoadingSave] = useState(false)
  const [parsed, setParsed] = useState<ParseResult | null>(null)

  async function callAppServer(path: string, body: any) {
    const { data } = await supabaseClient.auth.getSession()
    const token = data?.session?.access_token
    if (!token) {
      message.error('未登录或会话已过期')
      return null
    }
    const resp = await fetch(`${import.meta.env.VITE_APP_SERVER_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(body)
    })
    const json = await resp.json().catch(() => null)
    if (!resp.ok || !json) {
      message.error('接口异常')
      return null
    }
    if (json.code !== 0) {
      message.error(json.msg || '操作失败')
      return null
    }
    return json.data
  }

  async function handleParse() {
    const text = rawText.trim()
    if (!text) {
      message.warning('请粘贴抖音复制内容')
      return
    }
    setLoadingParse(true)
    try {
      const data = await callAppServer('/admin/douyin/parse', { text })
      if (!data) return
      setParsed(data as ParseResult)
      message.success('解析成功')
    } finally {
      setLoadingParse(false)
    }
  }

  async function handlePublish() {
    if (!parsed) {
      message.warning('请先解析')
      return
    }
    setLoadingSave(true)
    try {
      const data = await callAppServer('/admin/douyin/publish', {
        source_url: parsed.source_url,
        play_url: parsed.play_url,
        cover_url: parsed.cover_url || null,
        description: parsed.description || null,
        duration: parsed.duration ?? null,
        width: parsed.width ?? null,
        height: parsed.height ?? null
      })
      if (!data?.id) return
      message.success('已发布')
      navigate('/videos')
    } finally {
      setLoadingSave(false)
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <Space style={{ marginBottom: 12 }}>
        <Button onClick={() => navigate('/videos')}>返回列表</Button>
        <Button type="primary" onClick={handleParse} loading={loadingParse}>
          解析
        </Button>
        <Button type="primary" onClick={handlePublish} loading={loadingSave} disabled={!parsed}>
          保存并发布
        </Button>
      </Space>

      <Card title="抖音解析新增（粘贴→解析→发布）">
        <Form layout="vertical">
          <Form.Item label="粘贴抖音复制内容">
            <Input.TextArea
              rows={6}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder="把抖音复制出来的一整段文案粘贴到这里，然后点【解析】"
            />
          </Form.Item>

          <Form.Item label="解析结果预览">
            {!parsed ? (
              <div style={{ color: '#999' }}>未解析</div>
            ) : (
              <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                <div style={{ width: 240 }}>
                  {parsed.cover_url ? (
                    <Image
                      src={parsed.cover_url}
                      width={240}
                      height={135}
                      style={{ objectFit: 'cover', borderRadius: 8 }}
                      preview
                    />
                  ) : (
                    <div
                      style={{
                        width: 240,
                        height: 135,
                        borderRadius: 8,
                        background: '#111',
                        color: '#666',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      无封面
                    </div>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ marginBottom: 8 }}>
                    <b>标题：</b>抖音精选
                  </div>
                  <div style={{ marginBottom: 8, wordBreak: 'break-all' }}>
                    <b>源链接（存 tg_file_id）：</b>
                    <div>{parsed.source_url}</div>
                  </div>
                  <div style={{ marginBottom: 8, wordBreak: 'break-all' }}>
                    <b>播放地址（存 play_url）：</b>
                    <div>{parsed.play_url}</div>
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <b>描述（存 description）：</b>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{parsed.description || '-'}</div>
                  </div>
                  <div style={{ color: '#999' }}>
                    aweme_id：{parsed.aweme_id || '-'}；时长：{parsed.duration ?? '-'}s； 过期：
                    {parsed.cdn_url_expired ?? '-'}
                  </div>
                </div>
              </div>
            )}
          </Form.Item>
        </Form>
      </Card>
    </div>
  )
}

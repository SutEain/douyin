import { List, useTable } from '@refinedev/antd'
import { Form, Input, Select, Table, Tag, Space, Button, DatePicker, InputNumber } from 'antd'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import { useMemo } from 'react'

dayjs.extend(utc)

const { RangePicker } = DatePicker

// 🚀 默认日期范围：最近 7 天（优化性能，避免一次性加载所有历史数据）
const DEFAULT_DATE_RANGE_DAYS = 7

const typeColors: Record<string, string> = {
  recharge: 'green',
  reward: 'blue',
  gift_out: 'orange',
  gift_in: 'purple',
  withdraw: 'volcano',
  red_packet_send: 'pink',
  red_packet_claim: 'cyan',
  hb_in: 'cyan',
  hb_out: 'pink',
  hb_refund: 'orange',
  dice_bet: 'orange',
  dice_reward: 'gold',
  dice_refund: 'default',
  watch_time_reward: 'blue',
  adjustment: 'geekblue',
  task_reward: 'gold',
  inheritance_in: 'lime',
  inheritance_out: 'red'
}

const typeLabels: Record<string, string> = {
  recharge: '充值',
  reward: '签到奖励',
  gift_out: '打赏支出',
  gift_in: '打赏收入',
  withdraw: '提现',
  red_packet_send: '发红包',
  red_packet_claim: '抢红包',
  hb_in: '群红包领取',
  hb_out: '群红包发送',
  hb_refund: '群红包退款',
  dice_bet: '骰子下注',
  dice_reward: '骰子奖励',
  dice_refund: '骰子退款',
  watch_time_reward: '观看时长奖励',
  adjustment: '手动调整',
  task_reward: '任务奖励',
  inheritance_in: '资产继承(入)',
  inheritance_out: '资产迁移(出)'
}

export const CoinTransactionList = () => {
  // 🚀 默认日期范围：最近 7 天
  const defaultDateRange = useMemo(() => {
    const end = dayjs().endOf('day')
    const start = end.subtract(DEFAULT_DATE_RANGE_DAYS - 1, 'day').startOf('day')
    return [start, end]
  }, [])

  const { tableProps, searchFormProps } = useTable({
    // 🚀 使用优化的视图，避免 LATERAL JOIN，性能提升 10-100 倍
    resource: 'admin_coin_transactions_list',
    syncWithLocation: true,
    // 🚀 优化：设置默认分页大小（每页 50 条）
    pagination: {
      pageSize: 50,
      showSizeChanger: true,
      pageSizeOptions: ['20', '50', '100', '200']
    },
    meta: {
      // 🚀 视图已经包含了 profiles 和 counterparty 信息，直接选择即可
      select: '*'
    },
    sorters: {
      initial: [{ field: 'created_at', order: 'desc' }]
    },
    filters: {
      // 🚀 默认日期范围：最近 7 天（优化性能）
      initial: [
        {
          field: 'created_at',
          operator: 'gte',
          value: defaultDateRange[0].toISOString()
        },
        {
          field: 'created_at',
          operator: 'lte',
          value: defaultDateRange[1].toISOString()
        }
      ]
    },
    onSearch: (params: Record<string, any>) => {
      const filters: any[] = []
      const userQ = String(params.user_q || '').trim()

      // 🚀 日期范围过滤（如果指定了日期范围，使用指定的；否则使用默认的最近 7 天）
      const hasDateRange = params.date_range && params.date_range.length === 2
      if (hasDateRange) {
        const [start, end] = params.date_range
        filters.push({
          field: 'created_at',
          operator: 'gte',
          value: start.toISOString()
        })
        filters.push({
          field: 'created_at',
          operator: 'lte',
          value: end.toISOString()
        })
      }
      // 注意：如果没有指定日期范围，filters.initial 中的默认日期范围会自动应用

      if (userQ) {
        const isNumeric = /^[0-9]+$/.test(userQ)
        if (isNumeric) {
          // 🚀 视图字段：user_numeric_id
          filters.push({
            field: 'user_numeric_id',
            operator: 'eq',
            value: Number(userQ)
          })
        } else {
          // 🚀 视图字段：user_nickname
          filters.push({
            field: 'user_nickname',
            operator: 'contains',
            value: userQ
          })
        }
      }

      if (params.type) {
        filters.push({ field: 'type', operator: 'eq', value: params.type })
      }

      // 🎯 搜索备注 (description)
      if (params.description_q) {
        filters.push({
          field: 'description',
          operator: 'contains',
          value: params.description_q.trim()
        })
      }

      // 🎯 关联 ID 搜索
      if (params.related_id) {
        filters.push({ field: 'related_id', operator: 'eq', value: params.related_id.trim() })
      }

      // 🎯 金额范围过滤
      if (
        params.min_amount !== undefined &&
        params.min_amount !== null &&
        params.min_amount !== ''
      ) {
        filters.push({ field: 'amount', operator: 'gte', value: Number(params.min_amount) })
      }
      if (
        params.max_amount !== undefined &&
        params.max_amount !== null &&
        params.max_amount !== ''
      ) {
        filters.push({ field: 'amount', operator: 'lte', value: Number(params.max_amount) })
      }

      return filters
    }
  })

  return (
    <List title="抖币流水">
      <Form {...searchFormProps} layout="inline" style={{ marginBottom: 16, rowGap: '12px' }}>
        <Form.Item name="user_q" label="用户">
          <Input placeholder="昵称/数字ID" style={{ width: 140 }} allowClear />
        </Form.Item>
        <Form.Item name="type" label="类型">
          <Select placeholder="全部类型" allowClear style={{ width: 140 }}>
            {Object.entries(typeLabels).map(([val, label]) => (
              <Select.Option key={val} value={val}>
                {label}
              </Select.Option>
            ))}
          </Select>
        </Form.Item>
        <Form.Item name="description_q" label="备注/关键词">
          <Input placeholder="搜索备注内容" style={{ width: 160 }} allowClear />
        </Form.Item>
        <Form.Item name="date_range" label="日期时间范围">
          <RangePicker
            showTime={{ format: 'HH:mm:ss' }}
            format="YYYY-MM-DD HH:mm:ss"
            style={{ width: 380 }}
            // 🚀 设置默认值为最近 7 天
            defaultValue={defaultDateRange as any}
            placeholder={['开始时间', '结束时间']}
          />
        </Form.Item>
        <Form.Item label="金额范围">
          <Space>
            <Form.Item name="min_amount" noStyle>
              <InputNumber placeholder="最小" style={{ width: 80 }} />
            </Form.Item>
            <span>-</span>
            <Form.Item name="max_amount" noStyle>
              <InputNumber placeholder="最大" style={{ width: 80 }} />
            </Form.Item>
          </Space>
        </Form.Item>
        <Form.Item name="related_id" label="关联ID">
          <Input placeholder="订单/关联业务ID" style={{ width: 180 }} allowClear />
        </Form.Item>
        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit">
              搜索
            </Button>
            <Button
              onClick={() => {
                searchFormProps.form?.resetFields()
                searchFormProps.onFinish?.({
                  user_q: undefined,
                  type: undefined,
                  description_q: undefined,
                  date_range: undefined,
                  min_amount: undefined,
                  max_amount: undefined,
                  related_id: undefined
                })
              }}
            >
              重置
            </Button>
          </Space>
        </Form.Item>
      </Form>

      <Table {...tableProps} rowKey="id" scroll={{ x: 1000 }}>
        <Table.Column
          title="用户"
          width={200}
          render={(_, record: any) => (
            <div>
              {/* 🚀 视图字段：user_nickname 或 profiles.nickname */}
              <div>{record.user_nickname || record.profiles?.nickname || '-'}</div>
              <div style={{ fontSize: 12, color: '#999' }}>
                ID: {record.user_numeric_id || record.profiles?.numeric_id || '-'}
              </div>
            </div>
          )}
        />
        <Table.Column
          dataIndex="type"
          title="类型"
          width={120}
          render={(v) => <Tag color={typeColors[v] || 'default'}>{typeLabels[v] || v}</Tag>}
        />
        <Table.Column
          dataIndex="amount"
          title="变动金额"
          width={120}
          render={(v) => (
            <span
              style={{
                fontFamily: 'monospace',
                fontWeight: 'bold',
                color: v > 0 ? '#52c41a' : '#ff4d4f'
              }}
            >
              {v > 0 ? `+${Number(v).toFixed(2)}` : Number(v).toFixed(2)}
            </span>
          )}
        />
        <Table.Column
          dataIndex="balance_after"
          title="变动后余额"
          width={120}
          render={(v) => <span style={{ fontFamily: 'monospace' }}>{Number(v).toFixed(2)}</span>}
        />
        <Table.Column
          dataIndex="description"
          title="备注"
          render={(v, record: any) => (
            <Space direction="vertical" size={0}>
              <span>{v || '-'}</span>
              {/* 🚀 视图字段：counterparty_nickname 或 counterparty.nickname */}
              {(record.counterparty_nickname || record.counterparty?.nickname) && (
                <small style={{ color: '#8c8c8c' }}>
                  {record.type === 'gift_in' ? '来自: ' : '打赏给: '}
                  {record.counterparty_nickname || record.counterparty?.nickname} (ID:{' '}
                  {record.counterparty_numeric_id || record.counterparty?.numeric_id})
                </small>
              )}
            </Space>
          )}
        />
        <Table.Column
          dataIndex="created_at"
          title="时间"
          width={180}
          render={(v) => (v ? dayjs(v).utcOffset(8).format('YYYY-MM-DD HH:mm:ss') : '-')}
        />
      </Table>
    </List>
  )
}

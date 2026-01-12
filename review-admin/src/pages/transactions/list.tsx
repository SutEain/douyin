import { List, useTable, DateField } from '@refinedev/antd'
import { Table, Space, Button, Tag, Form, Select, DatePicker } from 'antd'

const { RangePicker } = DatePicker

export const TransactionList = () => {
  const { tableProps, searchFormProps } = useTable({
    resource: 'coin_transactions',
    sorters: {
      initial: [{ field: 'created_at', order: 'desc' }]
    },
    meta: {
      select: '*, user:profiles!coin_transactions_user_id_fkey(id, nickname, username, numeric_id)'
    },
    pagination: {
      pageSize: 50
    },
    onSearch: (params: any) => {
      const filters: any[] = []

      if (params.type) {
        filters.push({ field: 'type', operator: 'eq', value: params.type })
      }
      if (params.user_id) {
        filters.push({ field: 'user_id', operator: 'eq', value: params.user_id })
      }
      if (params.date_range && params.date_range.length === 2) {
        filters.push({
          field: 'created_at',
          operator: 'gte',
          value: params.date_range[0].startOf('day').toISOString()
        })
        filters.push({
          field: 'created_at',
          operator: 'lte',
          value: params.date_range[1].endOf('day').toISOString()
        })
      }

      return filters
    }
  })

  const getTypeTag = (type: string) => {
    const typeMap: Record<string, { color: string; text: string }> = {
      recharge: { color: 'green', text: '充值' },
      reward: { color: 'blue', text: '奖励' },
      gift_out: { color: 'red', text: '送礼' },
      gift_in: { color: 'green', text: '收礼' },
      withdraw: { color: 'orange', text: '提现' },
      dice_bet: { color: 'purple', text: '骰子下注' },
      dice_reward: { color: 'cyan', text: '骰子奖励' },
      dice_refund: { color: 'blue', text: '骰子退款' },
      rps_bet: { color: 'purple', text: '猜拳下注' },
      rps_reward: { color: 'cyan', text: '猜拳奖励' },
      rps_refund: { color: 'blue', text: '猜拳退款' },
      hb_out: { color: 'red', text: '发红包' },
      hb_in: { color: 'green', text: '领红包' },
      task_reward: { color: 'blue', text: '任务奖励' },
      watch_time_reward: { color: 'blue', text: '观看奖励' },
      author_views_reward: { color: 'blue', text: '播放奖励' },
      adjustment: { color: 'gold', text: '后台调整' }
    }
    const t = typeMap[type] || { color: 'default', text: type }
    return <Tag color={t.color}>{t.text}</Tag>
  }

  // 计算当前筛选条件下的总计
  const calculateSummary = () => {
    if (!tableProps.dataSource) return { total: 0, in: 0, out: 0 }

    const total = tableProps.dataSource.reduce(
      (acc: any, item: any) => {
        const amount = Number(item.amount) || 0
        if (amount > 0) {
          acc.in += amount
        } else {
          acc.out += Math.abs(amount)
        }
        acc.total += amount
        return acc
      },
      { total: 0, in: 0, out: 0 }
    )

    return total
  }

  const summary = calculateSummary()

  return (
    <List
      title="资金流水"
      headerButtons={
        <Space>
          <div style={{ fontSize: 14 }}>
            <Tag color="green">收入: {summary.in.toFixed(2)} 抖币</Tag>
            <Tag color="red">支出: {summary.out.toFixed(2)} 抖币</Tag>
            <Tag color="blue">净额: {summary.total.toFixed(2)} 抖币</Tag>
          </div>
          <Button
            onClick={() => {
              searchFormProps.form?.resetFields()
              searchFormProps.form?.submit()
            }}
          >
            刷新
          </Button>
        </Space>
      }
    >
      <Form {...searchFormProps} layout="inline" style={{ marginBottom: 16 }}>
        <Form.Item name="type" label="交易类型">
          <Select placeholder="全部" allowClear style={{ width: 150 }}>
            <Select.Option value="recharge">充值</Select.Option>
            <Select.Option value="reward">奖励</Select.Option>
            <Select.Option value="gift_out">送礼</Select.Option>
            <Select.Option value="gift_in">收礼</Select.Option>
            <Select.Option value="withdraw">提现</Select.Option>
            <Select.Option value="dice_bet">骰子下注</Select.Option>
            <Select.Option value="dice_reward">骰子奖励</Select.Option>
            <Select.Option value="rps_bet">猜拳下注</Select.Option>
            <Select.Option value="rps_reward">猜拳奖励</Select.Option>
            <Select.Option value="hb_out">发红包</Select.Option>
            <Select.Option value="hb_in">领红包</Select.Option>
            <Select.Option value="task_reward">任务奖励</Select.Option>
            <Select.Option value="adjustment">后台调整</Select.Option>
          </Select>
        </Form.Item>
        <Form.Item name="date_range" label="时间范围">
          <RangePicker />
        </Form.Item>
        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit">
              搜索
            </Button>
            <Button
              onClick={() => {
                searchFormProps.form?.resetFields()
                searchFormProps.form?.submit()
              }}
            >
              重置
            </Button>
          </Space>
        </Form.Item>
      </Form>

      <Table
        {...tableProps}
        rowKey="id"
        size="small"
        pagination={{
          ...(tableProps.pagination as any),
          showSizeChanger: true,
          pageSizeOptions: [20, 50, 100, 200]
        }}
      >
        <Table.Column
          title="用户"
          width={150}
          render={(_: any, record: any) =>
            record.user?.nickname ||
            record.user?.username ||
            `ID: ${record.user?.numeric_id}` ||
            '-'
          }
        />
        <Table.Column
          title="交易类型"
          dataIndex="type"
          width={120}
          render={(type: string) => getTypeTag(type)}
        />
        <Table.Column
          title="金额"
          dataIndex="amount"
          width={120}
          render={(amount: number) => {
            const isPositive = amount > 0
            return (
              <span style={{ color: isPositive ? '#52c41a' : '#ff4d4f', fontWeight: 'bold' }}>
                {isPositive ? '+' : ''}
                {amount.toFixed(2)} 抖币
              </span>
            )
          }}
        />
        <Table.Column
          title="余额"
          dataIndex="balance_after"
          width={120}
          render={(balance: number) => `${balance?.toFixed(2) || 0} 抖币`}
        />
        <Table.Column
          title="描述"
          dataIndex="description"
          width={300}
          ellipsis
          render={(desc: string) => desc || '-'}
        />
        <Table.Column
          title="关联ID"
          dataIndex="related_id"
          width={120}
          render={(id: string) =>
            id ? <span style={{ fontFamily: 'monospace' }}>{id}</span> : '-'
          }
        />
        <Table.Column
          title="交易时间"
          dataIndex="created_at"
          width={180}
          render={(value: any) => <DateField value={value} format="YYYY-MM-DD HH:mm:ss" />}
        />
      </Table>
    </List>
  )
}

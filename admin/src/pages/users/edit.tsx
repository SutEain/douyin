import { Edit, useForm } from '@refinedev/antd'
import { useOne } from '@refinedev/core'
import { Form, Input, Select, Switch, DatePicker, Row, Col, Divider, Avatar, Spin } from 'antd'
import { useParams, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import dayjs from 'dayjs'

export const UserEdit = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  // 手动获取数据
  const { data, isLoading } = useOne({
    resource: 'profiles',
    id: id!
  })

  const record = data?.data

  const { formProps, saveButtonProps, form } = useForm({
    resource: 'profiles',
    action: 'edit',
    id: id,
    redirect: false,
    onMutationSuccess: () => {
      navigate('/users')
    }
  })

  // 当数据加载完成后，设置表单值
  useEffect(() => {
    if (record && form) {
      form.setFieldsValue({
        nickname: record.nickname,
        username: record.username,
        bio: record.bio,
        avatar_url: record.avatar_url,
        cover_url: record.cover_url,
        gender: record.gender,
        birthday: record.birthday ? dayjs(record.birthday) : null,
        country: record.country,
        tg_user_id: record.tg_user_id,
        tg_username: record.tg_username,
        lang: record.lang,
        video_count: record.video_count,
        follower_count: record.follower_count,
        following_count: record.following_count,
        total_likes: record.total_likes,
        auto_approve: record.auto_approve,
        show_collect: record.show_collect !== false,
        show_like: record.show_like !== false,
        show_tg_username: record.show_tg_username !== false
      })
    }
  }, [record, form])

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: '50px' }}>
        <Spin size="large" />
      </div>
    )
  }

  return (
    <Edit saveButtonProps={saveButtonProps}>
      <Form {...formProps} layout="vertical">
        {/* 头像预览 */}
        {record?.avatar_url && (
          <div style={{ marginBottom: 24, textAlign: 'center' }}>
            <Avatar src={record.avatar_url} size={80} />
            <div style={{ marginTop: 8, color: '#999' }}>数字ID: {record.numeric_id || '-'}</div>
          </div>
        )}

        <Divider orientation="left">基本信息</Divider>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item label="昵称" name="nickname">
              <Input placeholder="用户昵称" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="用户名" name="username">
              <Input placeholder="唯一用户名" addonBefore="@" />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item label="个人简介" name="bio">
          <Input.TextArea rows={3} placeholder="用户的个人简介" maxLength={200} showCount />
        </Form.Item>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item label="头像URL" name="avatar_url">
              <Input placeholder="头像图片地址" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="封面URL" name="cover_url">
              <Input placeholder="主页封面图片地址" />
            </Form.Item>
          </Col>
        </Row>

        <Divider orientation="left">个人资料</Divider>
        <Row gutter={16}>
          <Col span={8}>
            <Form.Item label="性别" name="gender">
              <Select placeholder="选择性别" allowClear>
                <Select.Option value={0}>未知</Select.Option>
                <Select.Option value={1}>男</Select.Option>
                <Select.Option value={2}>女</Select.Option>
              </Select>
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item
              label="生日"
              name="birthday"
              getValueProps={(value) => ({
                value: value ? dayjs(value) : null
              })}
              getValueFromEvent={(date) => (date ? date.format('YYYY-MM-DD') : null)}
            >
              <DatePicker style={{ width: '100%' }} placeholder="选择生日" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="国家/地区" name="country">
              <Input placeholder="如：中国" />
            </Form.Item>
          </Col>
        </Row>

        <Divider orientation="left">Telegram 信息</Divider>
        <Row gutter={16}>
          <Col span={8}>
            <Form.Item label="TG User ID" name="tg_user_id">
              <Input disabled style={{ backgroundColor: '#f5f5f5' }} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="TG Username" name="tg_username">
              <Input disabled style={{ backgroundColor: '#f5f5f5' }} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="语言" name="lang">
              <Input disabled style={{ backgroundColor: '#f5f5f5' }} />
            </Form.Item>
          </Col>
        </Row>

        <Divider orientation="left">统计数据（只读）</Divider>
        <Row gutter={16}>
          <Col span={6}>
            <Form.Item label="视频数" name="video_count">
              <Input disabled style={{ backgroundColor: '#f5f5f5' }} />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item label="粉丝数" name="follower_count">
              <Input disabled style={{ backgroundColor: '#f5f5f5' }} />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item label="关注数" name="following_count">
              <Input disabled style={{ backgroundColor: '#f5f5f5' }} />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item label="获赞数" name="total_likes">
              <Input disabled style={{ backgroundColor: '#f5f5f5' }} />
            </Form.Item>
          </Col>
        </Row>

        <Divider orientation="left">隐私与权限</Divider>
        <Row gutter={16}>
          <Col span={6}>
            <Form.Item label="自动审核" name="auto_approve" valuePropName="checked">
              <Switch checkedChildren="开启" unCheckedChildren="关闭" />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item label="公开收藏" name="show_collect" valuePropName="checked">
              <Switch checkedChildren="公开" unCheckedChildren="私密" />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item label="公开喜欢" name="show_like" valuePropName="checked">
              <Switch checkedChildren="公开" unCheckedChildren="私密" />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item label="显示TG用户名" name="show_tg_username" valuePropName="checked">
              <Switch checkedChildren="显示" unCheckedChildren="隐藏" />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Edit>
  )
}

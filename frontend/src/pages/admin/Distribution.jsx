import { useState, useEffect } from 'react';
import { ConfigProvider, theme as antdTheme, Table, Modal, Space, Typography, Progress, Alert, App, Popconfirm } from 'antd';
import {
  BarChart3,
  Package,
  Play,
  RefreshCw,
  Plus,
  Trash2,
  AlertTriangle,
  ArrowRight
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { BACKEND_HTTP } from '../../config';
import Layout from '../../components/Layout';
import { useTheme } from '../../context/ThemeContext';

const { Title, Text } = Typography;

const Distribution = () => {
  const navigate = useNavigate();
  const { theme: currentTheme } = useTheme();
  const [distributions, setDistributions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [suggestion, setSuggestion] = useState(null);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [newDist, setNewDist] = useState({ name: '', num_boxes: 15 });
  const [selectedDist, setSelectedDist] = useState(null);
  const [distDetail, setDistDetail] = useState(null);

  const adminToken = sessionStorage.getItem('ouroboros_token');

  useEffect(() => {
    if (!adminToken) {
      navigate('/');
    }
  }, [adminToken, navigate]);

  const fetchDistributions = async () => {
    if (!adminToken) return;
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_HTTP}/api/distribution`, { headers: { 'token': adminToken } });
      const data = await res.json();
      setDistributions(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchSuggestion = async () => {
    if (!adminToken) return;
    try {
      const res = await fetch(`${BACKEND_HTTP}/api/distribution/suggest`, { headers: { 'token': adminToken } });
      const data = await res.json();
      setSuggestion(data);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchDetail = async (id) => {
    if (!adminToken) return;
    try {
      const res = await fetch(`${BACKEND_HTTP}/api/distribution/${id}`, { headers: { 'token': adminToken } });
      const data = await res.json();
      setDistDetail(data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchDistributions();
    fetchSuggestion();
  }, []);

  const handleCreate = async () => {
    try {
      const res = await fetch(`${BACKEND_HTTP}/api/distribution`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'token': adminToken },
        body: JSON.stringify(newDist)
      });
      if (res.ok) {
        setIsModalVisible(false);
        fetchDistributions();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCalculate = async (id) => {
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_HTTP}/api/distribution/${id}/calculate`, {
        method: 'POST',
        headers: { 'token': adminToken }
      });
      const data = await res.json();
      if (res.ok) {
        Modal.success({
          title: 'Distribuição Calculada',
          className: 'premium-modal',
          content: (
            <div style={{ color: 'white' }}>
              <p>{data.message}</p>
              {data.warnings?.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <Text type="warning">Avisos:</Text>
                  <ul>{data.warnings.map((w, i) => <li key={i} style={{ color: 'var(--warning)' }}>{w}</li>)}</ul>
                </div>
              )}
            </div>
          )
        });
        fetchDistributions();
        if (id === selectedDist?.id) fetchDetail(id);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      const res = await fetch(`${BACKEND_HTTP}/api/distribution/${id}`, {
        method: 'DELETE',
        headers: { 'token': adminToken }
      });
      if (res.ok) {
        if (selectedDist?.id === id) setSelectedDist(null);
        fetchDistributions();
      } else {
        const err = await res.json();
        Modal.error({ title: 'Não foi possível excluir', content: err.detail, className: 'premium-modal' });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleActivate = async (id) => {
    try {
      const res = await fetch(`${BACKEND_HTTP}/api/distribution/${id}/activate`, {
        method: 'PUT',
        headers: { 'token': adminToken }
      });
      if (res.ok) {
        fetchDistributions();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const columns = [
    { 
      title: 'Identificação', 
      dataIndex: 'name', 
      render: (text) => <span style={{ color: 'var(--text-main)', fontWeight: 600 }}>{text}</span> 
    },
    { 
      title: 'Caixas', 
      dataIndex: 'num_boxes',
      render: (num) => <span style={{ color: 'var(--lime-primary)' }}>{num} und.</span>
    },
    { 
      title: 'Status', 
      dataIndex: 'status',
      render: (status) => {
        const colors = { planning: 'var(--warning)', active: 'var(--success)', complete: 'var(--lime-primary)' };
        const labels = { planning: 'Planejamento', active: 'Ativo (Packing)', complete: 'Concluído' };
        return (
          <span style={{ 
            color: colors[status], 
            padding: '4px 8px', 
            background: 'rgba(255,255,255,0.05)', 
            borderRadius: '4px',
            fontSize: '0.8rem',
            border: `1px solid ${colors[status]}44`
          }}>
            {labels[status] || status}
          </span>
        );
      }
    },
    {
      title: 'Ações',
      key: 'actions',
      render: (_, record) => (
        <Space>
          <button 
            className="btn btn-outline" 
            style={{ padding: '6px 12px', fontSize: '0.85rem' }}
            onClick={() => { setSelectedDist(record); fetchDetail(record.id); }}
          >
            <BarChart3 size={14} /> Detalhes
          </button>
          
          {record.status === 'planning' && (
            <button 
              className="btn" 
              style={{ padding: '6px 12px', fontSize: '0.85rem' }}
              onClick={() => handleCalculate(record.id)}
            >
              <RefreshCw size={14} /> Calcular
            </button>
          )}
          
          {record.status === 'planning' && (
            <button
              className="btn"
              style={{ padding: '6px 12px', fontSize: '0.85rem', background: 'var(--success)' }}
              onClick={() => handleActivate(record.id)}
            >
              <Play size={14} /> Ativar
            </button>
          )}

          <Popconfirm
            title="Excluir rodada"
            description="Esta ação é permanente. Deseja continuar?"
            onConfirm={() => handleDelete(record.id)}
            okText="Excluir"
            cancelText="Cancelar"
            okButtonProps={{ danger: true }}
          >
            <button
              className="btn btn-outline"
              style={{ padding: '6px 12px', fontSize: '0.85rem', color: 'var(--danger)', borderColor: 'var(--danger)' }}
            >
              <Trash2 size={14} />
            </button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <ConfigProvider
      theme={{
        algorithm: currentTheme === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: '#349754',
          borderRadius: 8,
          colorBgContainer: currentTheme === 'dark' ? '#1a1a1a' : '#ffffff',
          colorBgElevated: currentTheme === 'dark' ? '#1a1a1a' : '#ffffff',
        },
      }}
    >
      <Layout role="admin">
        <div className="distribution-page animate-fade-in">
          <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
            <div>
              <Title level={2} style={{ margin: 0, color: 'var(--text-main)' }}>Logística de Distribuição</Title>
              <Text type="secondary">Transforme seu inventário em caixas de entrega para as lojas</Text>
            </div>
            <button className="btn" onClick={() => setIsModalVisible(true)}>
              <Plus size={18} /> Nova Rodada
            </button>
          </header>

          <div className="grid-container">
            <div className="main-col">
              <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
                <Table 
                  loading={loading}
                  columns={columns} 
                  dataSource={distributions} 
                  rowKey="id"
                  pagination={false}
                  className="premium-table"
                />
              </div>

              {selectedDist && distDetail && (
                <div className="glass-panel mt-8 animate-fade-in">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                    <Title level={4} style={{ margin: 0 }}>Distribuição: {selectedDist.name}</Title>
                    <button className="btn btn-outline" onClick={() => setSelectedDist(null)}>Fechar</button>
                  </div>
                  
                  <div className="box-grid">
                    {distDetail.boxes.map(box => (
                      <div key={box.id} className={`box-item ${box.status}`}>
                        <div className="box-header">
                          <span className="box-num">📦 #{box.box_number}</span>
                          <span className={`status-pill ${box.status}`}>{box.status}</span>
                        </div>
                        <div className="box-store">{box.store_name}</div>
                        <ul className="box-content">
                          {box.items.map((item, i) => (
                            <li key={i}>
                              <span>{item.category_name}</span>
                              <strong>x{item.target_quantity}</strong>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <aside className="sidebar">
              <div className="glass-panel mb-6">
                <Title level={5} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                  <BarChart3 size={18} className="text-primary" /> Sugestão IA
                </Title>
                {suggestion ? (
                  <div className="suggestion-content">
                    <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: 16 }}>
                      {suggestion.reasoning}
                    </p>
                    <div className="ideal-badge">
                      <span>RECOMENDADO</span>
                      <div className="value">{suggestion.suggested}</div>
                      <span className="unit">CAIXAS FÍSICAS</span>
                    </div>
                  </div>
                ) : <Text type="secondary">Analisando inventário...</Text>}
              </div>

              <div className="glass-panel">
                <Title level={5} style={{ marginBottom: 16 }}>Manual de Operação</Title>
                <div className="steps-v">
                  <div className="step-v">
                    <div className="dot">1</div>
                    <div className="t">Crie uma nova rodada de distribuição para definir o período.</div>
                  </div>
                  <div className="step-v">
                    <div className="dot">2</div>
                    <div className="t">Calcule os itens: o sistema divide os produtos de forma justa e equilibrada.</div>
                  </div>
                  <div className="step-v">
                    <div className="dot">3</div>
                    <div className="t">Ative o Packing para liberar a montagem para os voluntários.</div>
                  </div>
                </div>
              </div>
            </aside>
          </div>

          <Modal
            title="Configurar Nova Distribuição"
            open={isModalVisible}
            onOk={handleCreate}
            onCancel={() => setIsModalVisible(false)}
            centered
            okText="Confirmar Planejamento"
            cancelText="Cancelar"
            className="premium-modal"
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '10px 0' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', color: currentTheme === 'dark' ? 'var(--text-muted)' : '#666' }}>Nome da Rodada</label>
                <input 
                  className="input-premium"
                  placeholder="Ex: Sábado - Manhã" 
                  value={newDist.name}
                  onChange={(e) => setNewDist({...newDist, name: e.target.value})}
                />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', color: currentTheme === 'dark' ? 'var(--text-muted)' : '#666' }}>Quantidade de Caixas Físicas Disponíveis</label>
                <input 
                  className="input-premium"
                  type="number" 
                  placeholder="Ex: 15"
                  value={newDist.num_boxes}
                  onChange={(e) => setNewDist({...newDist, num_boxes: parseInt(e.target.value)})}
                />
                {suggestion && <p style={{ marginTop: '8px', fontSize: '0.8rem', color: 'var(--lime-primary)' }}>Sugestão ideal: {suggestion.suggested} caixas.</p>}
              </div>
            </div>
          </Modal>

          <style>{`
            .distribution-page { padding: 40px; max-width: 1600px; margin: 0 auto; color: var(--text-main); }
            .grid-container { display: grid; grid-template-columns: 1fr 320px; gap: 32px; align-items: flex-start; }
            
            [data-theme="light"] .glass-panel {
              background: rgba(255, 255, 255, 0.7) !important;
              box-shadow: 0 8px 32px 0 rgba(52, 151, 84, 0.08) !important;
              border: 1px solid rgba(52, 151, 84, 0.2) !important;
            }

            .premium-table .ant-table {
              background: transparent !important;
              color: var(--text-main) !important;
            }
            .premium-table .ant-table-thead > tr > th {
              background: rgba(255,255,255,0.02) !important;
              color: var(--text-muted) !important;
              border-bottom: 1px solid var(--border-lime) !important;
            }
            .premium-table .ant-table-cell {
              border-bottom: 1px solid rgba(255,255,255,0.05) !important;
            }
            .premium-table .ant-table-row:hover .ant-table-cell {
              background: rgba(52, 151, 84, 0.05) !important;
            }

            .box-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
            .box-item {
              background: var(--element-bg);
              border: 1px solid rgba(255,255,255,0.05);
              border-radius: 8px;
              padding: 16px;
              transition: all 0.2s;
            }
            .box-item:hover { transform: translateY(-3px); border-color: var(--border-lime); }
            .box-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
            .box-num { font-weight: 700; color: var(--text-main); }
            .status-pill { font-size: 0.7rem; text-transform: uppercase; padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.1); }
            .status-pill.done { color: var(--success); border-color: var(--success); }
            .status-pill.in_progress { color: var(--warning); border-color: var(--warning); }
            
            .box-store { font-size: 0.8rem; color: var(--lime-primary); margin-bottom: 12px; }
            .box-content { list-style: none; padding: 0; margin: 0; }
            .box-content li { display: flex; justify-content: space-between; font-size: 0.85rem; padding: 4px 0; border-top: 1px solid rgba(255,255,255,0.03); }
            
            .ideal-badge {
              background: ${currentTheme === 'dark' ? 'linear-gradient(135deg, var(--lime-primary) 0%, #1a1a1a 100%)' : 'rgba(52, 151, 84, 0.05)'};
              border-radius: 12px;
              padding: 24px;
              text-align: center;
              border: 1px solid var(--border-lime);
            }
            .ideal-badge span { font-size: 0.7rem; letter-spacing: 0.1em; opacity: 0.8; }
            .ideal-badge .value { font-size: 3rem; font-weight: 800; line-height: 1; margin: 8px 0; }
            
            .steps-v { display: flex; flex-direction: column; gap: 20px; }
            .step-v { display: flex; gap: 12px; }
            .step-v .dot { 
              width: 24px; height: 24px; border-radius: 50%; background: var(--lime-primary); 
              color: var(--bg-dark); display: flex; align-items: center; justify-content: center;
              font-weight: bold; font-size: 0.8rem; flex-shrink: 0;
            }
            .step-v .t { font-size: 0.85rem; color: var(--text-muted); line-height: 1.4; }

            .text-primary { color: var(--lime-primary); }
            .mt-8 { margin-top: 32px; }
            .mb-6 { margin-bottom: 24px; }

            /* Modal Styling */
            .premium-modal .ant-modal-content {
              background: ${currentTheme === 'dark' ? 'var(--bg-card)' : '#ffffff'} !important;
              border: 1px solid var(--border-lime) !important;
              box-shadow: 0 0 30px rgba(0,0,0,0.2) !important;
            }
            .premium-modal .ant-modal-header { background: transparent !important; border-bottom: 1px solid rgba(255,255,255,0.05) !important; }
            .premium-modal .ant-modal-title { color: var(--text-main) !important; }
            .premium-modal .ant-modal-close { color: var(--text-muted) !important; }
          `}</style>
        </div>
      </Layout>
    </ConfigProvider>
  );
};

export default Distribution;

import React, { useState, useEffect, useCallback } from 'react';
import { ConfigProvider, theme as antdTheme, Modal, Typography, Progress, Badge, Empty, Space, message, notification } from 'antd';
import { Package, CheckCircle2, User, Clock, AlertCircle, ClipboardList, PackageCheck, Play } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { BACKEND_HTTP } from '../../config';
import { usePackingWebSocket } from '../../hooks/usePackingWebSocket';
import Layout from '../../components/Layout';
import { useTheme } from '../../context/ThemeContext';

const { Title, Text } = Typography;

const Packing = () => {
  const navigate = useNavigate();
  const { theme: currentTheme } = useTheme();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedBox, setSelectedBox] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [packerName, setPackerName] = useState(localStorage.getItem('packerName') || '');

  const token = sessionStorage.getItem('ouroboros_token');

  useEffect(() => {
    if (!token) {
      navigate('/');
    }
  }, [token, navigate]);

  const fetchData = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${BACKEND_HTTP}/api/packing/active`, { headers: { 'token': token } });
      if (res.status === 404) {
        setData(null);
        return;
      }
      const result = await res.json();
      setData(result);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  // WebSocket for real-time updates
  const { status } = usePackingWebSocket((msg) => {
    if (msg.type === 'box_claimed' || msg.type === 'box_completed' || msg.type === 'box_released' || msg.type === 'distribution_recalculated') {
      fetchData();
      if (msg.type === 'distribution_recalculated') {
        notification.info({
          message: 'Distribuição Atualizada',
          description: 'O inventário mudou e as caixas pendentes foram recalculadas.',
          placement: 'top'
        });
      }
    }
    if (msg.type === 'distribution_status_changed' && msg.status === 'active') {
      fetchData();
    }
  });

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleClaim = async (boxId) => {
    if (!packerName) {
      message.error('Por favor, informe seu nome para continuar.');
      return;
    }
    localStorage.setItem('packerName', packerName);
    
    try {
      const res = await fetch(`${BACKEND_HTTP}/api/packing/boxes/${boxId}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'token': token },
        body: JSON.stringify({ responsible_name: packerName })
      });
      if (res.ok) {
        message.success('Você assumiu esta caixa!');
        fetchData(); 
      } else {
        const err = await res.json();
        message.error(err.detail);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleComplete = async (boxId) => {
    try {
      const res = await fetch(`${BACKEND_HTTP}/api/packing/boxes/${boxId}/complete`, {
        method: 'POST',
        headers: { 'token': token }
      });
      if (res.ok) {
        message.success('Caixa concluída com sucesso!');
        setIsModalOpen(false);
        setSelectedBox(null);
        fetchData();
      } else {
        const err = await res.json();
        message.error(err.detail || 'Erro ao concluir caixa.');
      }
    } catch (err) {
      console.error(err);
      message.error('Sem conexão com o servidor.');
    }
  };

  const handleCancel = async (boxId) => {
    try {
      const res = await fetch(`${BACKEND_HTTP}/api/packing/boxes/${boxId}/cancel`, {
        method: 'POST',
        headers: { 'token': token }
      });
      if (res.ok) {
        message.info('Você liberou a caixa.');
        setIsModalOpen(false);
        setSelectedBox(null);
        fetchData();
      } else {
        const err = await res.json();
        message.error(err.detail || 'Erro ao liberar caixa.');
      }
    } catch (err) {
      console.error(err);
      message.error('Sem conexão com o servidor.');
    }
  };

  const { distribution, boxes, stats } = data || {};

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
      <Layout role="admin" isConnected={status === 'connected'}>
        <div className="packing-container animate-fade-in">
          <header className="packing-header">
            <div className="title-row">
              <Title level={2} style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
                <ClipboardList className="text-primary" /> Montagem de Caixas
              </Title>
              <div className="ws-status">
                <Badge status={status === 'connected' ? 'processing' : 'error'} text={status === 'connected' ? 'Sincronizado' : 'Offline'} />
              </div>
            </div>

            {!loading && data && (
              <div className="glass-panel stats-strip">
                <div className="dist-name">
                  <Clock size={14} /> Ativo: {distribution.name}
                </div>
                <div className="stat-counters">
                  <div className="counter-item">
                    <span className="label">LIVRES</span>
                    <span className="val">{stats.pending}</span>
                  </div>
                  <div className="counter-item">
                    <span className="label" style={{color: 'var(--warning)'}}>EM MÃOS</span>
                    <span className="val" style={{color: 'var(--warning)'}}>{stats.in_progress}</span>
                  </div>
                  <div className="counter-item">
                    <span className="label" style={{color: 'var(--success)'}}>CONCLUÍDAS</span>
                    <span className="val" style={{color: 'var(--success)'}}>{stats.done}</span>
                  </div>
                </div>
                <Progress
                  percent={Math.round((stats.done / stats.total_boxes) * 100)}
                  status="active"
                  strokeColor={{ '0%': 'var(--lime-primary)', '100%': 'var(--lime-light)' }}
                  style={{ marginTop: 12 }}
                  showInfo={false}
                />
              </div>
            )}
          </header>

          {loading && (
            <Text style={{ color: 'var(--text-muted)', display: 'block', textAlign: 'center', marginTop: 64 }}>Carregando...</Text>
          )}

          {!loading && !data && (
            <div className="glass-panel animate-fade-in" style={{ padding: '80px 20px', marginTop: 32, textAlign: 'center' }}>
              <Empty
                image={<Package size={64} style={{ color: 'var(--lime-primary)', opacity: 0.3, margin: '0 auto' }} />}
                description={<Title level={4} style={{ color: 'var(--text-main)' }}>Aguardando Distribuição</Title>}
              >
                <Text type="secondary">Nenhuma rodada ativa no momento. Aguarde o comando do Banco Central.</Text>
              </Empty>
            </div>
          )}

          {!loading && data && (<>
          <div className="packing-grid">
            {boxes.map(box => (
              <div 
                key={box.id} 
                className={`glass-panel box-card-interactive ${box.status} ${box.responsible_name === packerName ? 'mine' : ''}`}
                onClick={() => { setSelectedBox(box); setIsModalOpen(true); }}
              >
                <div className="card-top">
                  <div className="box-id">Caixa <strong>#{box.box_number}</strong></div>
                  <div className={`status-icon-badge ${box.status}`}>
                    {box.status === 'done' ? <PackageCheck size={16}/> : box.status === 'in_progress' ? <User size={16}/> : <Package size={16}/>}
                  </div>
                </div>
                
                <div className="card-mid">
                  <span className="store-pill">{box.store_name}</span>
                </div>
                
                <div className="card-bot">
                  {box.status === 'in_progress' ? (
                    <div className="packer-info">
                      <User size={12} /> {box.responsible_name}
                    </div>
                  ) : box.status === 'done' ? (
                    <div className="packer-info done">Pronta para entrega</div>
                  ) : (
                    <div className="packer-info pending">Pendente</div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <Modal
            title={null}
            open={isModalOpen}
            onCancel={() => { setIsModalOpen(false); setSelectedBox(null); }}
            footer={null}
            centered
            className="premium-modal packing-modal"
            destroyOnClose
          >
            {selectedBox && (
              <div className="modal-content-glass">
                <div className="modal-header-packing">
                  <div className={`icon-box ${selectedBox.status}`}>
                    <PackageCheck size={32} />
                  </div>
                  <div>
                    <Title level={3} style={{ margin: 0 }}>Caixa #{selectedBox.box_number}</Title>
                    <Text type="secondary" style={{color: 'var(--lime-primary)'}}>{selectedBox.store_name}</Text>
                  </div>
                </div>

                <div className="items-list-packing">
                  <Title level={5} style={{ marginBottom: 16, fontSize: '0.9rem', opacity: 0.7 }}>CHECKLIST DE ITENS:</Title>
                  <div className="items-container">
                    {selectedBox.items.map((item, idx) => (
                      <div key={idx} className="item-row">
                        <div className="item-name">{item.category_name}</div>
                        <div className="item-qty">x{item.target_quantity}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="modal-footer-packing">
                  {selectedBox.status === 'pending' && (
                    <div className="claim-box">
                      <p>Para assumir esta caixa, informe seu nome:</p>
                      <input 
                        className="input-premium"
                        placeholder="Nome do Voluntário"
                        style={{ marginBottom: 16 }}
                        value={packerName}
                        onChange={(e) => setPackerName(e.target.value)}
                      />
                      <button className="btn" style={{width: '100%', height: 48}} onClick={() => handleClaim(selectedBox.id)}>
                        <Play size={18} /> Começar Montagem
                      </button>
                    </div>
                  )}

                  {selectedBox.status === 'in_progress' && selectedBox.responsible_name === packerName && (
                    <div className="actions">
                      <button className="btn" style={{width: '110', background: 'var(--success)', marginBottom: 12}} onClick={() => handleComplete(selectedBox.id)}>
                        <CheckCircle2 size={18} /> Concluir Montagem
                      </button>
                      <button className="btn btn-outline" style={{width: '100', color: 'var(--danger)', borderColor: 'var(--danger)'}} onClick={() => handleCancel(selectedBox.id)}>
                        Soltar Caixa
                      </button>
                    </div>
                  )}

                  {selectedBox.status === 'in_progress' && selectedBox.responsible_name !== packerName && (
                    <div className="busy-alert">
                      <AlertCircle size={32} className="text-warning" />
                      <div>
                        <strong>Caixa em uso</strong><br/>
                        <Text type="secondary">{selectedBox.responsible_name} está montando esta caixa.</Text>
                      </div>
                    </div>
                  )}

                  {selectedBox.status === 'done' && (
                    <div className="finished-alert">
                      <CheckCircle2 size={40} className="text-success" />
                      <div>
                        <strong>Montagem Finalizada</strong><br/>
                        <Text type="secondary">Esta caixa está lacrada e pronta.</Text>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </Modal>
          </>)}

          <style>{`
            [data-theme="light"] .glass-panel, [data-theme="light"] .box-card-interactive {
              background: rgba(255, 255, 255, 0.7) !important;
              box-shadow: 0 4px 16px 0 rgba(52, 151, 84, 0.08) !important;
              border: 1px solid rgba(52, 151, 84, 0.2) !important;
            }

            .packing-container { padding: 24px; max-width: 1200px; margin: 0 auto; color: var(--text-main); }
            .packing-header { margin-bottom: 32px; }
            .title-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
            .ws-status { font-size: 0.8rem; }
            
            .stats-strip { padding: 20px; border-radius: 16px; position: relative; overflow: hidden; }
            .dist-name { font-size: 0.85rem; color: var(--text-muted); display: flex; align-items: center; gap: 6px; margin-bottom: 12px; }
            .stat-counters { display: flex; gap: 32px; }
            .counter-item { display: flex; flex-direction: column; }
            .counter-item .label { font-size: 0.65rem; letter-spacing: 0.1em; font-weight: 700; opacity: 0.7; }
            .counter-item .val { font-size: 1.5rem; font-weight: 800; line-height: 1.2; }

            .packing-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px; }
            
            .box-card-interactive {
              padding: 16px;
              cursor: pointer;
              transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
              border-radius: 12px;
              display: flex;
              flex-direction: column;
              gap: 12px;
            }
            .box-card-interactive:hover { transform: translateY(-4px) scale(1.02); border-color: var(--lime-primary); }
            .box-card-interactive.mine { box-shadow: 0 0 20px var(--lime-glow); border-color: var(--lime-primary); }
            
            .card-top { display: flex; justify-content: space-between; align-items: center; }
            .box-id { font-size: 0.85rem; color: var(--text-muted); }
            .box-id strong { color: var(--text-main); font-size: 1.1rem; }
            
            .status-icon-badge {
              width: 32px; height: 32px; border-radius: 50%;
              display: flex; align-items: center; justify-content: center;
              background: rgba(255,255,255,0.03);
              color: var(--text-muted);
              border: 1px solid rgba(255,255,255,0.05);
            }
            .status-icon-badge.done { color: var(--success); background: rgba(16, 185, 129, 0.1); border-color: var(--success); }
            .status-icon-badge.in_progress { color: var(--warning); background: rgba(245, 158, 11, 0.1); border-color: var(--warning); }
            
            .store-pill {
              font-size: 0.7rem; font-weight: 600; text-transform: uppercase;
              padding: 4px 10px; border-radius: 20px;
              background: var(--lime-glow); color: var(--lime-primary);
              border: 1px solid var(--border-lime);
            }
            
            .packer-info { font-size: 0.75rem; color: var(--text-muted); display: flex; align-items: center; gap: 4px; }
            .packer-info.done { color: var(--success); font-weight: 600; }
            .packer-info.pending { opacity: 0.5; }

            /* Modal Styling */
            .packing-modal .ant-modal-content {
              background: ${currentTheme === 'dark' ? 'var(--bg-glass)' : '#ffffff'} !important;
              backdrop-filter: var(--glass-blur);
              border: 1px solid var(--border-lime) !important;
              padding: 0 !important;
              overflow: hidden;
              box-shadow: 0 0 30px rgba(0,0,0,0.1) !important;
            }
            .modal-content-glass { padding: 32px; }
            
            .modal-header-packing { display: flex; gap: 20px; align-items: center; margin-bottom: 32px; }
            .icon-box {
              width: 64px; height: 64px; border-radius: 16px;
              background: var(--lime-glow); color: var(--lime-primary);
              display: flex; align-items: center; justify-content: center;
              border: 1px solid var(--border-lime);
            }
            .icon-box.done { background: rgba(16, 185, 129, 0.1); color: var(--success); border-color: var(--success); }
            .icon-box.in_progress { background: rgba(245, 158, 11, 0.1); color: var(--warning); border-color: var(--warning); }
            
            .items-container { display: flex; flex-direction: column; gap: 8px; }
            .item-row {
              display: flex; justify-content: space-between; padding: 12px 16px;
              background: rgba(255,255,255,0.03); border-radius: 8px;
              border: 1px solid rgba(255,255,255,0.05);
            }
            .item-name { font-weight: 500; }
            .item-qty { font-weight: 700; color: var(--lime-primary); }

            .claim-box p { font-size: 0.85rem; color: var(--text-muted); margin-bottom: 12px; }
            .busy-alert, .finished-alert {
              display: flex; gap: 16px; align-items: center; padding: 20px; border-radius: 12px;
              background: rgba(0,0,0,0.05); border: 1px solid rgba(255,255,255,0.05);
            }
            
            .text-primary { color: var(--lime-primary); }
            .text-warning { color: var(--warning); }
            .text-success { color: var(--success); }
          `}</style>
        </div>
      </Layout>
    </ConfigProvider>
  );
};

export default Packing;

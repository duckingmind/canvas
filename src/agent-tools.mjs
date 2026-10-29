export const agentMetadata = Object.freeze({
  "namespace": "canvas",
  "targets": [
    "desktop",
    "web"
  ],
  "contract_version": "1.3.0",
  "summary": "创建和管理画布，导入参考图片、配置图片/视频/音乐生成，查看和恢复音色任务、请求取消视频或音频任务，分块读取生成结果和本地录音。",
  "keywords": [
    "canvas",
    "画布",
    "图片生成",
    "视频生成",
    "音乐生成",
    "节点",
    "工作流"
  ],
  "guide": {
    "entry": "agent/guide.md",
    "topics": [
      {
        "id": "workflow",
        "title": "生成工作流",
        "entry": "agent/workflow.md"
      },
      {
        "id": "recovery",
        "title": "状态与失败恢复",
        "entry": "agent/recovery.md"
      }
    ]
  },
  "examples": "agent/examples.json"
})

/**
 * Code-owned Agent implementation registry.
 *
 * Every tool is registered through this function. The desktop/runtime adapter
 * supplies handlers at application load time; the build adapter supplies only
 * a collector, so the exact same implementation code produces the MCP catalog
 * without importing the application UI.
 */
export function registerAgentTools(registry, handlers) {
  if (!registry || typeof registry.register !== 'function') throw new TypeError('agent registry must expose register()')
  const collectOnly = handlers === undefined
  if (!collectOnly && (!handlers || typeof handlers !== 'object' || Array.isArray(handlers))) throw new TypeError('agent handlers must be an object')
  const registeredNames = new Set()
  const disposers = []
  const cleanup = () => {
    for (const dispose of disposers.splice(0).reverse()) {
      try { dispose() } catch { /* Cleanup continues for the remaining handlers. */ }
    }
  }
  const register = (declaration) => {
    try {
      registeredNames.add(declaration.name)
      const handler = collectOnly ? undefined : handlers[declaration.name]
      if (!collectOnly && typeof handler !== 'function') throw new Error('Missing canvas agent capability handler: ' + declaration.name)
      const unregister = collectOnly ? registry.register(declaration) : registry.register(declaration, handler)
      if (typeof unregister === 'function') disposers.push(unregister)
    } catch (error) {
      cleanup()
      throw error
    }
  }
  register(
    {
      "name": "read_metadata",
      "description": "读取 Canvas 应用的标识、名称和版本。",
      "access": "read",
      "idempotent": true,
      "input_schema": {
        "type": "object",
        "properties": {},
        "required": [],
        "additionalProperties": false,
        "description": "调用参数；未声明的字段会被拒绝。"
      },
      "output_schema": {
        "type": "object",
        "description": "当前应用身份。",
        "properties": {
          "appId": {
            "type": "string",
            "description": "应用唯一标识。"
          },
          "version": {
            "type": "string",
            "description": "当前启用的应用版本。"
          },
          "name": {
            "type": "string",
            "description": "应用显示名称。"
          }
        },
        "required": [
          "appId",
          "version",
          "name"
        ],
        "additionalProperties": false
      },
      "destructive": false,
      "open_world": false,
      "billable": false,
      "completion": "completed"
    }
  )
  register(
    {
      "name": "list_documents",
      "description": "列出已加载到本机的画布，不含回收站。返回 activeDocumentId，供新建或切换画布时校验。",
      "access": "read",
      "idempotent": true,
      "input_schema": {
        "type": "object",
        "properties": {
          "offset": {
            "type": "integer",
            "minimum": 0,
            "description": "分页起始索引，默认 0；使用上次返回的 nextOffset 继续读取。"
          },
          "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 100,
            "description": "每页最多条数，默认 50，范围 1–100。"
          }
        },
        "required": [],
        "additionalProperties": false,
        "description": "调用参数；未声明的字段会被拒绝。"
      },
      "output_schema": {
        "type": "object",
        "description": "",
        "properties": {
          "activeDocumentId": {
            "type": "string",
            "description": "当前画布 ID；无活动画布时为空字符串。"
          },
          "documents": {
            "type": "array",
            "description": "当前页的本机画布摘要，不包含已删除画布。",
            "items": {
              "type": "object",
              "description": "",
              "properties": {
                "id": {
                  "type": "string",
                  "description": "画布 ID。"
                },
                "name": {
                  "type": "string",
                  "description": "画布名称。"
                },
                "updatedAt": {
                  "type": "string",
                  "description": "最后更新的 ISO 时间字符串。"
                },
                "nodeCount": {
                  "type": "integer",
                  "description": "保存的节点数量。",
                  "minimum": 0
                },
                "pendingTasks": {
                  "type": "integer",
                  "description": "排队或运行中的生成任务数量。",
                  "minimum": 0
                }
              },
              "required": [
                "id",
                "name",
                "updatedAt",
                "nodeCount",
                "pendingTasks"
              ],
              "additionalProperties": false
            }
          },
          "nextOffset": {
            "type": [
              "integer",
              "null"
            ],
            "description": "下一页起始位置；null 表示没有下一页。",
            "minimum": 0
          }
        },
        "required": [
          "activeDocumentId",
          "documents",
          "nextOffset"
        ],
        "additionalProperties": false
      },
      "destructive": false,
      "open_world": false,
      "billable": false,
      "completion": "completed"
    }
  )
  register(
    {
      "name": "open_document",
      "description": "保存当前画布后打开指定画布。expected_active_document_id 必须与 list_documents 返回值一致。 完成后调用 read_state 获取编辑器最新 revision。",
      "access": "write",
      "idempotent": false,
      "input_schema": {
        "type": "object",
        "properties": {
          "idempotency_key": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "本次用户操作的唯一键，最多 128 字符。同一次请求重试必须原样复用键和全部参数；新操作才生成新键。"
          },
          "expected_active_document_id": {
            "type": "string",
            "maxLength": 128,
            "description": "先调用 list_documents 获取 activeDocumentId；无当前画布时传空字符串，防止误切换用户画布。"
          },
          "document_id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "目标画布 ID。编辑器写入须为最近 read_state 的 documentId；open_document 从 list_documents 选择 ID。"
          }
        },
        "required": [
          "idempotency_key",
          "expected_active_document_id",
          "document_id"
        ],
        "additionalProperties": false,
        "description": "调用参数；未声明的字段会被拒绝。"
      },
      "output_schema": {
        "type": "object",
        "description": "",
        "properties": {
          "documentId": {
            "type": [
              "string",
              "null"
            ],
            "description": "切换后的画布 ID；无活动画布时为 null。"
          },
          "name": {
            "type": [
              "string",
              "null"
            ],
            "description": "切换后的画布名称；无活动画布时为 null。"
          },
          "savedLocally": {
            "type": "boolean",
            "description": "切换前的编辑已保存本机，不代表云端同步完成。",
            "enum": [
              true
            ]
          }
        },
        "required": [
          "documentId",
          "name",
          "savedLocally"
        ],
        "additionalProperties": false
      },
      "destructive": false,
      "open_world": false,
      "billable": false,
      "completion": "completed"
    }
  )
  register(
    {
      "name": "create_document",
      "description": "创建并打开空白画布。先用 list_documents 获取当前画布 ID；无当前画布时传空字符串。 完成后调用 read_state 获取编辑器最新 revision。",
      "access": "write",
      "idempotent": false,
      "input_schema": {
        "type": "object",
        "properties": {
          "idempotency_key": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "本次用户操作的唯一键，最多 128 字符。同一次请求重试必须原样复用键和全部参数；新操作才生成新键。"
          },
          "expected_active_document_id": {
            "type": "string",
            "maxLength": 128,
            "description": "先调用 list_documents 获取 activeDocumentId；无当前画布时传空字符串，防止误切换用户画布。"
          },
          "name": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200,
            "description": "画布名称，必须包含非空白字符，最多 200 字符。"
          }
        },
        "required": [
          "idempotency_key",
          "expected_active_document_id",
          "name"
        ],
        "additionalProperties": false,
        "description": "调用参数；未声明的字段会被拒绝。"
      },
      "output_schema": {
        "type": "object",
        "description": "",
        "properties": {
          "documentId": {
            "type": [
              "string",
              "null"
            ],
            "description": "创建并打开的画布 ID。"
          },
          "name": {
            "type": [
              "string",
              "null"
            ],
            "description": "新画布名称。"
          },
          "savedLocally": {
            "type": "boolean",
            "description": "新画布已保存本机；不代表云端同步完成。",
            "enum": [
              true
            ]
          }
        },
        "required": [
          "documentId",
          "name",
          "savedLocally"
        ],
        "additionalProperties": false
      },
      "destructive": false,
      "open_world": false,
      "billable": false,
      "completion": "completed"
    }
  )
  register(
    {
      "name": "read_state",
      "description": "读取当前画布、revision、分页节点和连线；不返回媒体字节或 URL。每次写入前读取并使用最新 documentId/revision。 节点和连线独立分页，nextOffset/nextEdgeOffset 为 null 时结束；跨页 revision 改变时重新读取。",
      "access": "read",
      "idempotent": true,
      "input_schema": {
        "type": "object",
        "properties": {
          "offset": {
            "type": "integer",
            "minimum": 0,
            "description": "分页起始索引，默认 0；使用上次返回的 nextOffset 继续读取。"
          },
          "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 100,
            "description": "每页最多条数，默认 50，范围 1–100。"
          },
          "edge_offset": {
            "type": "integer",
            "minimum": 0,
            "description": "连线分页起始索引，默认 0；使用 nextEdgeOffset 继续读取，独立于节点 offset。"
          }
        },
        "required": [],
        "additionalProperties": false,
        "description": "调用参数；未声明的字段会被拒绝。"
      },
      "output_schema": {
        "type": "object",
        "description": "",
        "properties": {
          "documentId": {
            "type": "string",
            "description": "当前画布 ID；所有编辑写入必须传此值。"
          },
          "name": {
            "type": "string",
            "description": "画布名称。"
          },
          "revision": {
            "type": "string",
            "description": "当前不透明版本令牌；每次编辑前重新读取，不能推算。"
          },
          "nodeCount": {
            "type": "integer",
            "description": "画布总节点数。",
            "minimum": 0
          },
          "edgeCount": {
            "type": "integer",
            "description": "画布总连线数。",
            "minimum": 0
          },
          "viewport": {
            "type": "object",
            "description": "当前视口。",
            "properties": {
              "x": {
                "type": "number",
                "description": "平移 X。"
              },
              "y": {
                "type": "number",
                "description": "平移 Y。"
              },
              "zoom": {
                "type": "number",
                "description": "缩放比例。"
              }
            },
            "required": [
              "x",
              "y",
              "zoom"
            ],
            "additionalProperties": false
          },
          "offset": {
            "type": "integer",
            "description": "本页节点起始位置。",
            "minimum": 0
          },
          "nextOffset": {
            "type": [
              "integer",
              "null"
            ],
            "description": "下一页起始位置；null 表示没有下一页。",
            "minimum": 0
          },
          "nodes": {
            "type": "array",
            "description": "当前页节点。",
            "items": {
              "type": "object",
              "description": "节点结构化摘要，不含媒体载荷、地址、提交参数和诊断原文。",
              "properties": {
                "id": {
                  "type": "string",
                  "description": "节点 ID。"
                },
                "type": {
                  "type": "string",
                  "description": "持久化节点类型；生成结果可能仍保存在 prompt 节点上。",
                  "enum": [
                    "note",
                    "prompt",
                    "image",
                    "video",
                    "audio"
                  ]
                },
                "title": {
                  "type": "string",
                  "description": "节点标题，最多返回 200 字符。",
                  "maxLength": 200
                },
                "text": {
                  "type": "string",
                  "description": "节点文本。摘要最多 1024 字符；read_node 每页最多 20000 字符。",
                  "maxLength": 20000
                },
                "textTruncated": {
                  "type": "boolean",
                  "description": "本页之后是否还有文本。"
                },
                "x": {
                  "type": "number",
                  "description": "画布坐标 X。"
                },
                "y": {
                  "type": "number",
                  "description": "画布坐标 Y。"
                },
                "width": {
                  "type": "number",
                  "description": "节点宽度。"
                },
                "height": {
                  "type": "number",
                  "description": "节点高度。"
                },
                "groupId": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "description": "所在分组 ID；无分组为 null。"
                },
                "mediaType": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "description": "媒体种类；便签或未设置时为 null。",
                  "enum": [
                    "image",
                    "video",
                    "audio",
                    null
                  ]
                },
                "modelId": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "description": "选中的模型 ID；未选择为 null。"
                },
                "status": {
                  "type": "string",
                  "description": "任务状态；idle 尚未提交，queued/running 进行中，completed 已完成，failed 失败。",
                  "enum": [
                    "idle",
                    "queued",
                    "running",
                    "completed",
                    "failed"
                  ]
                },
                "taskId": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "description": "平台任务 ID；尚未取得或不适用时为 null。"
                },
                "resultOf": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "description": "生成此结果的源提示词节点 ID；无来源为 null。"
                },
                "hasMedia": {
                  "type": "boolean",
                  "description": "是否已有媒体内容；不包含媒体地址和字节。"
                },
                "imageSettings": {
                  "type": [
                    "object",
                    "null"
                  ],
                  "description": "",
                  "properties": {
                    "quality": {
                      "type": "string",
                      "description": "从 list_models 的可用选项中选择。",
                      "minLength": 1,
                      "maxLength": 128
                    },
                    "resolution": {
                      "type": "string",
                      "description": "从 list_models 的可用选项中选择。",
                      "minLength": 1,
                      "maxLength": 128
                    },
                    "size": {
                      "type": "string",
                      "description": "从 list_models 的可用选项中选择。",
                      "minLength": 1,
                      "maxLength": 128
                    },
                    "count": {
                      "type": "integer",
                      "description": "生成张数，不得超出模型 maxCount。",
                      "minimum": 1,
                      "maximum": 1000
                    },
                    "aspectRatio": {
                      "type": "string",
                      "description": "从 list_models 的可用选项中选择。",
                      "minLength": 1,
                      "maxLength": 128
                    },
                    "outputFormat": {
                      "type": "string",
                      "description": "从 list_models 的 outputFormats 中选择编码格式。",
                      "minLength": 1,
                      "maxLength": 32
                    }
                  },
                  "required": [],
                  "additionalProperties": false
                },
                "videoSettings": {
                  "type": [
                    "object",
                    "null"
                  ],
                  "description": "",
                  "properties": {
                    "resolution": {
                      "type": "string",
                      "description": "从 list_models 的可用选项中选择。",
                      "minLength": 1,
                      "maxLength": 128
                    },
                    "size": {
                      "type": "string",
                      "description": "从 list_models 的可用选项中选择。",
                      "minLength": 1,
                      "maxLength": 128
                    },
                    "aspect_ratio": {
                      "type": "string",
                      "description": "从 list_models 的可用选项中选择。",
                      "minLength": 1,
                      "maxLength": 128
                    },
                    "duration": {
                      "type": "number",
                      "minimum": 0.01,
                      "description": "视频时长（秒），须为模型公布的时长。"
                    },
                    "generate_audio": {
                      "type": "boolean"
                    }
                  },
                  "required": [],
                  "additionalProperties": false
                },
                "musicSettings": {
                  "type": [
                    "object",
                    "null"
                  ],
                  "description": "音乐生成设置；未设置时为 null。",
                  "properties": {
                    "audio_mode": {
                      "type": "string"
                    },
                    "output_format": {
                      "type": "string"
                    },
                    "duration": {
                      "type": "number",
                      "minimum": 0.01
                    },
                    "lyrics_optimizer": {
                      "type": "boolean"
                    }
                  },
                  "required": [],
                  "additionalProperties": false
                },
                "musicLyrics": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "description": "独立保存的歌词；未设置时为 null。"
                },
                "audioMode": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "enum": [
                    "music",
                    "voice_design",
                    "tts",
                    "recording",
                    null
                  ],
                  "description": "音频创作模式；旧音频节点默认为 music，其他媒体为 null。tts 仅标识历史只读记录，不支持创建、配置、提交、恢复或取消。"
                },
                "voicePreviewText": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "description": "音色设计的试听文本；未设置为 null。"
                },
                "voiceId": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "description": "音色设计生成的 voice_id；未生成为 null。"
                }
              },
              "required": [
                "id",
                "type",
                "title",
                "text",
                "textTruncated",
                "x",
                "y",
                "width",
                "height",
                "groupId",
                "mediaType",
                "modelId",
                "status",
                "taskId",
                "resultOf",
                "hasMedia",
                "imageSettings",
                "videoSettings",
                "musicSettings",
                "musicLyrics",
                "audioMode",
                "voicePreviewText",
                "voiceId"
              ],
              "additionalProperties": false
            }
          },
          "edges": {
            "type": "array",
            "description": "从 edge_offset 开始、最多 limit 条的连线。",
            "items": {
              "type": "object",
              "description": "",
              "properties": {
                "id": {
                  "type": "string",
                  "description": "连线 ID。"
                },
                "from": {
                  "type": "string",
                  "description": "来源节点 ID。"
                },
                "to": {
                  "type": "string",
                  "description": "目标节点 ID。"
                }
              },
              "required": [
                "id",
                "from",
                "to"
              ],
              "additionalProperties": false
            }
          },
          "nextEdgeOffset": {
            "type": [
              "integer",
              "null"
            ],
            "description": "下一页连线起始位置；null 表示连线已结束。",
            "minimum": 0
          }
        },
        "required": [
          "documentId",
          "name",
          "revision",
          "nodeCount",
          "edgeCount",
          "viewport",
          "offset",
          "nextOffset",
          "nodes",
          "edges",
          "nextEdgeOffset"
        ],
        "additionalProperties": false
      },
      "destructive": false,
      "open_world": false,
      "billable": false,
      "completion": "completed"
    }
  )
  register(
    {
      "name": "read_node",
      "description": "按 ID 读取节点详情和分页完整文本；不返回媒体地址。",
      "access": "read",
      "idempotent": true,
      "input_schema": {
        "type": "object",
        "properties": {
          "node_id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "已有节点 ID，来自 read_state、read_node 或创建结果。"
          },
          "text_offset": {
            "type": "integer",
            "minimum": 0,
            "description": "文本起始字符位置，默认 0；使用 nextTextOffset 读取下一段。"
          }
        },
        "required": [
          "node_id"
        ],
        "additionalProperties": false,
        "description": "调用参数；未声明的字段会被拒绝。"
      },
      "output_schema": {
        "type": "object",
        "description": "",
        "properties": {
          "documentId": {
            "type": "string",
            "description": "节点所属的当前画布 ID。"
          },
          "revision": {
            "type": "string",
            "description": "读取时的画布版本。"
          },
          "node": {
            "type": "object",
            "description": "节点结构化摘要，不含媒体载荷、地址、提交参数和诊断原文。",
            "properties": {
              "id": {
                "type": "string",
                "description": "节点 ID。"
              },
              "type": {
                "type": "string",
                "description": "持久化节点类型；生成结果可能仍保存在 prompt 节点上。",
                "enum": [
                  "note",
                  "prompt",
                  "image",
                  "video",
                  "audio"
                ]
              },
              "title": {
                "type": "string",
                "description": "节点标题，最多返回 200 字符。",
                "maxLength": 200
              },
              "text": {
                "type": "string",
                "description": "节点文本。摘要最多 1024 字符；read_node 每页最多 20000 字符。",
                "maxLength": 20000
              },
              "textTruncated": {
                "type": "boolean",
                "description": "本页之后是否还有文本。"
              },
              "x": {
                "type": "number",
                "description": "画布坐标 X。"
              },
              "y": {
                "type": "number",
                "description": "画布坐标 Y。"
              },
              "width": {
                "type": "number",
                "description": "节点宽度。"
              },
              "height": {
                "type": "number",
                "description": "节点高度。"
              },
              "groupId": {
                "type": [
                  "string",
                  "null"
                ],
                "description": "所在分组 ID；无分组为 null。"
              },
              "mediaType": {
                "type": [
                  "string",
                  "null"
                ],
                "description": "媒体种类；便签或未设置时为 null。",
                "enum": [
                  "image",
                  "video",
                  "audio",
                  null
                ]
              },
              "modelId": {
                "type": [
                  "string",
                  "null"
                ],
                "description": "选中的模型 ID；未选择为 null。"
              },
              "status": {
                "type": "string",
                "description": "任务状态；idle 尚未提交，queued/running 进行中，completed 已完成，failed 失败。",
                "enum": [
                  "idle",
                  "queued",
                  "running",
                  "completed",
                  "failed"
                ]
              },
              "taskId": {
                "type": [
                  "string",
                  "null"
                ],
                "description": "平台任务 ID；尚未取得或不适用时为 null。"
              },
              "resultOf": {
                "type": [
                  "string",
                  "null"
                ],
                "description": "生成此结果的源提示词节点 ID；无来源为 null。"
              },
              "hasMedia": {
                "type": "boolean",
                "description": "是否已有媒体内容；不包含媒体地址和字节。"
              },
              "imageSettings": {
                "type": [
                  "object",
                  "null"
                ],
                "description": "",
                "properties": {
                  "quality": {
                    "type": "string",
                    "description": "从 list_models 的可用选项中选择。",
                    "minLength": 1,
                    "maxLength": 128
                  },
                  "resolution": {
                    "type": "string",
                    "description": "从 list_models 的可用选项中选择。",
                    "minLength": 1,
                    "maxLength": 128
                  },
                  "size": {
                    "type": "string",
                    "description": "从 list_models 的可用选项中选择。",
                    "minLength": 1,
                    "maxLength": 128
                  },
                  "count": {
                    "type": "integer",
                    "description": "生成张数，不得超出模型 maxCount。",
                    "minimum": 1,
                    "maximum": 1000
                  },
                  "aspectRatio": {
                    "type": "string",
                    "description": "从 list_models 的可用选项中选择。",
                    "minLength": 1,
                    "maxLength": 128
                  },
                  "outputFormat": {
                    "type": "string",
                    "description": "从 list_models 的 outputFormats 中选择编码格式。",
                    "minLength": 1,
                    "maxLength": 32
                  }
                },
                "required": [],
                "additionalProperties": false
              },
              "videoSettings": {
                "type": [
                  "object",
                  "null"
                ],
                "description": "",
                "properties": {
                  "resolution": {
                    "type": "string",
                    "description": "从 list_models 的可用选项中选择。",
                    "minLength": 1,
                    "maxLength": 128
                  },
                  "size": {
                    "type": "string",
                    "description": "从 list_models 的可用选项中选择。",
                    "minLength": 1,
                    "maxLength": 128
                  },
                  "aspect_ratio": {
                    "type": "string",
                    "description": "从 list_models 的可用选项中选择。",
                    "minLength": 1,
                    "maxLength": 128
                  },
                  "duration": {
                    "type": "number",
                    "minimum": 0.01,
                    "description": "视频时长（秒），须为模型公布的时长。"
                  },
                  "generate_audio": {
                    "type": "boolean"
                  }
                },
                "required": [],
                "additionalProperties": false
              },
              "musicSettings": {
                "type": [
                  "object",
                  "null"
                ],
                "description": "音乐生成设置；未设置时为 null。",
                "properties": {
                  "audio_mode": {
                    "type": "string"
                  },
                  "output_format": {
                    "type": "string"
                  },
                  "duration": {
                    "type": "number",
                    "minimum": 0.01
                  },
                  "lyrics_optimizer": {
                    "type": "boolean"
                  }
                },
                "required": [],
                "additionalProperties": false
              },
              "musicLyrics": {
                "type": [
                  "string",
                  "null"
                ],
                "description": "独立保存的歌词；未设置时为 null。"
              },
              "audioMode": {
                "type": [
                  "string",
                  "null"
                ],
                "enum": [
                  "music",
                  "voice_design",
                  "tts",
                  "recording",
                  null
                ],
                "description": "音频创作模式；旧音频节点默认为 music，其他媒体为 null。tts 仅标识历史只读记录，不支持创建、配置、提交、恢复或取消。"
              },
              "voicePreviewText": {
                "type": [
                  "string",
                  "null"
                ],
                "description": "音色设计的试听文本；未设置为 null。"
              },
              "voiceId": {
                "type": [
                  "string",
                  "null"
                ],
                "description": "音色设计生成的 voice_id；未生成为 null。"
              }
            },
            "required": [
              "id",
              "type",
              "title",
              "text",
              "textTruncated",
              "x",
              "y",
              "width",
              "height",
              "groupId",
              "mediaType",
              "modelId",
              "status",
              "taskId",
              "resultOf",
              "hasMedia",
              "imageSettings",
              "videoSettings",
              "musicSettings",
              "musicLyrics",
              "audioMode",
              "voicePreviewText",
              "voiceId"
            ],
            "additionalProperties": false
          },
          "nextTextOffset": {
            "type": [
              "integer",
              "null"
            ],
            "description": "下一段文本起始位置；null 表示文本已结束。",
            "minimum": 0
          }
        },
        "required": [
          "documentId",
          "revision",
          "node",
          "nextTextOffset"
        ],
        "additionalProperties": false
      },
      "destructive": false,
      "open_world": false,
      "billable": false,
      "completion": "completed"
    }
  )
  register(
    {
      "name": "rename_document",
      "description": "重命名当前画布，保留撤销历史并保存本机。 写入前调用 read_state 获取 documentId/revision；同一请求重试复用原幂等键及参数。",
      "access": "write",
      "idempotent": false,
      "input_schema": {
        "type": "object",
        "properties": {
          "idempotency_key": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "本次用户操作的唯一键，最多 128 字符。同一次请求重试必须原样复用键和全部参数；新操作才生成新键。"
          },
          "document_id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "目标画布 ID。编辑器写入须为最近 read_state 的 documentId；open_document 从 list_documents 选择 ID。"
          },
          "expected_revision": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "最近 read_state 返回的原样 revision；并发编辑会使旧值失效。"
          },
          "name": {
            "type": "string",
            "minLength": 1,
            "maxLength": 200,
            "description": "画布名称，必须包含非空白字符，最多 200 字符。"
          }
        },
        "required": [
          "idempotency_key",
          "document_id",
          "expected_revision",
          "name"
        ],
        "additionalProperties": false,
        "description": "调用参数；未声明的字段会被拒绝。"
      },
      "output_schema": {
        "type": "object",
        "description": "写入完成及本机保存结果。",
        "properties": {
          "documentId": {
            "type": "string",
            "description": "已修改的画布 ID。"
          },
          "appliedRevision": {
            "type": "string",
            "description": "本次修改提交后的 revision。"
          },
          "revision": {
            "type": "string",
            "description": "本次操作保存的完整画布快照 revision；如期间有其他编辑，可能与 appliedRevision 不同。"
          },
          "savedLocally": {
            "type": "boolean",
            "description": "本次状态已保存本机；不代表云端同步完成。",
            "enum": [
              true
            ]
          }
        },
        "required": [
          "documentId",
          "appliedRevision",
          "revision",
          "savedLocally"
        ],
        "additionalProperties": false
      },
      "destructive": true,
      "open_world": false,
      "billable": false,
      "completion": "completed"
    }
  )
  register(
    {
      "name": "create_note",
      "description": "创建文本便签；保存本机并可撤销。 写入前调用 read_state 获取 documentId/revision；同一请求重试复用原幂等键及参数。",
      "access": "write",
      "idempotent": false,
      "input_schema": {
        "type": "object",
        "properties": {
          "idempotency_key": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "本次用户操作的唯一键，最多 128 字符。同一次请求重试必须原样复用键和全部参数；新操作才生成新键。"
          },
          "document_id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "目标画布 ID。编辑器写入须为最近 read_state 的 documentId；open_document 从 list_documents 选择 ID。"
          },
          "expected_revision": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "最近 read_state 返回的原样 revision；并发编辑会使旧值失效。"
          },
          "title": {
            "type": "string",
            "maxLength": 200,
            "description": "节点标题，允许空字符串，最多 200 字符。"
          },
          "text": {
            "type": "string",
            "maxLength": 20000,
            "description": "便签或提示词文本，允许空字符串，最多 20000 字符。"
          },
          "x": {
            "type": "number",
            "minimum": -100000,
            "maximum": 100000,
            "description": "节点画布坐标 X；创建时默认从 100 起依次排列。"
          },
          "y": {
            "type": "number",
            "minimum": -100000,
            "maximum": 100000,
            "description": "节点画布坐标 Y；创建时默认 100。"
          }
        },
        "required": [
          "idempotency_key",
          "document_id",
          "expected_revision",
          "title",
          "text"
        ],
        "additionalProperties": false,
        "description": "调用参数；未声明的字段会被拒绝。"
      },
      "output_schema": {
        "type": "object",
        "description": "",
        "properties": {
          "documentId": {
            "type": "string",
            "description": "已修改的画布 ID。"
          },
          "appliedRevision": {
            "type": "string",
            "description": "本次修改提交后的 revision。"
          },
          "revision": {
            "type": "string",
            "description": "本次操作保存的完整画布快照 revision；如期间有其他编辑，可能与 appliedRevision 不同。"
          },
          "savedLocally": {
            "type": "boolean",
            "description": "本次状态已保存本机；不代表云端同步完成。",
            "enum": [
              true
            ]
          },
          "nodeId": {
            "type": "string",
            "description": "新便签节点 ID。"
          }
        },
        "required": [
          "documentId",
          "appliedRevision",
          "revision",
          "savedLocally",
          "nodeId"
        ],
        "additionalProperties": false
      },
      "destructive": false,
      "open_world": false,
      "billable": false,
      "completion": "completed"
    }
  )
  register(
    {
      "name": "create_nodes",
      "description": "批量创建便签或图片/视频/音乐提示词节点，不自动执行生成。模型 ID 先从 list_models 读取。 写入前调用 read_state 获取 documentId/revision；同一请求重试复用原幂等键及参数。",
      "access": "write",
      "idempotent": false,
      "input_schema": {
        "type": "object",
        "properties": {
          "idempotency_key": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "本次用户操作的唯一键，最多 128 字符。同一次请求重试必须原样复用键和全部参数；新操作才生成新键。"
          },
          "document_id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "目标画布 ID。编辑器写入须为最近 read_state 的 documentId；open_document 从 list_documents 选择 ID。"
          },
          "expected_revision": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "最近 read_state 返回的原样 revision；并发编辑会使旧值失效。"
          },
          "nodes": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "type": {
                  "type": "string",
                  "enum": [
                    "note",
                    "prompt"
                  ],
                  "description": "note 创建文本便签；prompt 创建可提交图片、视频或音乐生成的提示词节点。"
                },
                "title": {
                  "type": "string",
                  "maxLength": 200,
                  "description": "节点标题，允许空字符串，最多 200 字符。"
                },
                "text": {
                  "type": "string",
                  "maxLength": 20000,
                  "description": "便签或提示词文本，允许空字符串，最多 20000 字符。"
                },
                "x": {
                  "type": "number",
                  "minimum": -100000,
                  "maximum": 100000,
                  "description": "节点画布坐标 X；创建时默认从 100 起依次排列。"
                },
                "y": {
                  "type": "number",
                  "minimum": -100000,
                  "maximum": 100000,
                  "description": "节点画布坐标 Y；创建时默认 100。"
                },
                "media_type": {
                  "type": "string",
                  "enum": [
                    "image",
                    "video",
                    "audio"
                  ],
                  "description": "仅 prompt 可用，image、video 或 audio（音乐），默认 image；note 不得设置。"
                },
                "model_id": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 256,
                  "description": "仅 prompt 可用。先从 list_models 选择 available=true 且类型匹配的 ID；提交生成前必须显式选择模型。"
                }
              },
              "required": [
                "type",
                "title",
                "text"
              ],
              "additionalProperties": false,
              "description": "列表条目；ID 必须来自已读取或创建的对象。"
            },
            "minItems": 1,
            "maxItems": 50,
            "description": "本次新增节点列表，1–50 项；只创建节点，不会提交模型生成。"
          }
        },
        "required": [
          "idempotency_key",
          "document_id",
          "expected_revision",
          "nodes"
        ],
        "additionalProperties": false,
        "description": "调用参数；未声明的字段会被拒绝。"
      },
      "output_schema": {
        "type": "object",
        "description": "",
        "properties": {
          "documentId": {
            "type": "string",
            "description": "已修改的画布 ID。"
          },
          "appliedRevision": {
            "type": "string",
            "description": "本次修改提交后的 revision。"
          },
          "revision": {
            "type": "string",
            "description": "本次操作保存的完整画布快照 revision；如期间有其他编辑，可能与 appliedRevision 不同。"
          },
          "savedLocally": {
            "type": "boolean",
            "description": "本次状态已保存本机；不代表云端同步完成。",
            "enum": [
              true
            ]
          },
          "nodeIds": {
            "type": "array",
            "description": "新节点 ID，顺序与输入 nodes 一致。",
            "items": {
              "type": "string",
              "description": "列表项。"
            }
          }
        },
        "required": [
          "documentId",
          "appliedRevision",
          "revision",
          "savedLocally",
          "nodeIds"
        ],
        "additionalProperties": false
      },
      "destructive": false,
      "open_world": false,
      "billable": false,
      "completion": "completed"
    }
  )
  register(
    {
      "name": "update_nodes",
      "description": "原子更新多个节点的文本、标题、位置、尺寸或提示词模型。拒绝修改正在生成的节点和媒体内容。 写入前调用 read_state 获取 documentId/revision；同一请求重试复用原幂等键及参数。",
      "access": "write",
      "idempotent": false,
      "input_schema": {
        "type": "object",
        "properties": {
          "idempotency_key": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "本次用户操作的唯一键，最多 128 字符。同一次请求重试必须原样复用键和全部参数；新操作才生成新键。"
          },
          "document_id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "目标画布 ID。编辑器写入须为最近 read_state 的 documentId；open_document 从 list_documents 选择 ID。"
          },
          "expected_revision": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "最近 read_state 返回的原样 revision；并发编辑会使旧值失效。"
          },
          "patches": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "node_id": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 128,
                  "description": "已有节点 ID，来自 read_state、read_node 或创建结果。"
                },
                "title": {
                  "type": "string",
                  "maxLength": 200,
                  "description": "节点标题，允许空字符串，最多 200 字符。"
                },
                "text": {
                  "type": "string",
                  "maxLength": 20000,
                  "description": "便签或提示词文本，允许空字符串，最多 20000 字符。"
                },
                "x": {
                  "type": "number",
                  "minimum": -100000,
                  "maximum": 100000,
                  "description": "节点画布坐标 X；创建时默认从 100 起依次排列。"
                },
                "y": {
                  "type": "number",
                  "minimum": -100000,
                  "maximum": 100000,
                  "description": "节点画布坐标 Y；创建时默认 100。"
                },
                "width": {
                  "type": "number",
                  "minimum": 40,
                  "maximum": 4000,
                  "description": "节点宽度，40–4000。"
                },
                "height": {
                  "type": "number",
                  "minimum": 40,
                  "maximum": 4000,
                  "description": "节点高度，40–4000。"
                },
                "model_id": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 256,
                  "description": "仅 prompt 可用。先从 list_models 选择 available=true 且类型匹配的 ID；提交生成前必须显式选择模型。"
                }
              },
              "required": [
                "node_id"
              ],
              "additionalProperties": false,
              "description": "列表条目；ID 必须来自已读取或创建的对象。"
            },
            "minItems": 1,
            "maxItems": 50,
            "description": "需要修改的节点列表，1–50 项，各 node_id 唯一；只填写需要更改的字段，整批校验通过后提交。"
          }
        },
        "required": [
          "idempotency_key",
          "document_id",
          "expected_revision",
          "patches"
        ],
        "additionalProperties": false,
        "description": "调用参数；未声明的字段会被拒绝。"
      },
      "output_schema": {
        "type": "object",
        "description": "写入完成及本机保存结果。",
        "properties": {
          "documentId": {
            "type": "string",
            "description": "已修改的画布 ID。"
          },
          "appliedRevision": {
            "type": "string",
            "description": "本次修改提交后的 revision。"
          },
          "revision": {
            "type": "string",
            "description": "本次操作保存的完整画布快照 revision；如期间有其他编辑，可能与 appliedRevision 不同。"
          },
          "savedLocally": {
            "type": "boolean",
            "description": "本次状态已保存本机；不代表云端同步完成。",
            "enum": [
              true
            ]
          }
        },
        "required": [
          "documentId",
          "appliedRevision",
          "revision",
          "savedLocally"
        ],
        "additionalProperties": false
      },
      "destructive": true,
      "open_world": false,
      "billable": false,
      "completion": "completed"
    }
  )
  register(
    {
      "name": "delete_nodes",
      "description": "删除明确指定的节点及其连线，并重建分组；可撤销；即使节点正在生成也允许删除，编辑器会停止其本地观察并丢弃迟到结果。 写入前调用 read_state 获取 documentId/revision；同一请求重试复用原幂等键及参数。",
      "access": "write",
      "idempotent": false,
      "input_schema": {
        "type": "object",
        "properties": {
          "idempotency_key": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "本次用户操作的唯一键，最多 128 字符。同一次请求重试必须原样复用键和全部参数；新操作才生成新键。"
          },
          "document_id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "目标画布 ID。编辑器写入须为最近 read_state 的 documentId；open_document 从 list_documents 选择 ID。"
          },
          "expected_revision": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "最近 read_state 返回的原样 revision；并发编辑会使旧值失效。"
          },
          "node_ids": {
            "type": "array",
            "items": {
              "type": "string",
              "minLength": 1,
              "maxLength": 128,
              "description": "列表条目；ID 必须来自已读取或创建的对象。"
            },
            "minItems": 1,
            "maxItems": 100,
            "description": "明确选择的节点 ID 列表，1–100 项，不能重复。"
          }
        },
        "required": [
          "idempotency_key",
          "document_id",
          "expected_revision",
          "node_ids"
        ],
        "additionalProperties": false,
        "description": "调用参数；未声明的字段会被拒绝。"
      },
      "output_schema": {
        "type": "object",
        "description": "写入完成及本机保存结果。",
        "properties": {
          "documentId": {
            "type": "string",
            "description": "已修改的画布 ID。"
          },
          "appliedRevision": {
            "type": "string",
            "description": "本次修改提交后的 revision。"
          },
          "revision": {
            "type": "string",
            "description": "本次操作保存的完整画布快照 revision；如期间有其他编辑，可能与 appliedRevision 不同。"
          },
          "savedLocally": {
            "type": "boolean",
            "description": "本次状态已保存本机；不代表云端同步完成。",
            "enum": [
              true
            ]
          }
        },
        "required": [
          "documentId",
          "appliedRevision",
          "revision",
          "savedLocally"
        ],
        "additionalProperties": false
      },
      "destructive": true,
      "open_world": false,
      "billable": false,
      "completion": "completed"
    }
  )
  register(
    {
      "name": "connect_nodes",
      "description": "连接已有节点作为工作流依赖，拒绝重复、循环或不支持的连接方向。 写入前调用 read_state 获取 documentId/revision；同一请求重试复用原幂等键及参数。",
      "access": "write",
      "idempotent": false,
      "input_schema": {
        "type": "object",
        "properties": {
          "idempotency_key": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "本次用户操作的唯一键，最多 128 字符。同一次请求重试必须原样复用键和全部参数；新操作才生成新键。"
          },
          "document_id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "目标画布 ID。编辑器写入须为最近 read_state 的 documentId；open_document 从 list_documents 选择 ID。"
          },
          "expected_revision": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "最近 read_state 返回的原样 revision；并发编辑会使旧值失效。"
          },
          "from_node_id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "来源节点 ID，可为便签、提示词或已有媒体内容的图片/视频节点。"
          },
          "to_node_id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "目标节点 ID，须为便签或尚未含生成结果的提示词节点。"
          }
        },
        "required": [
          "idempotency_key",
          "document_id",
          "expected_revision",
          "from_node_id",
          "to_node_id"
        ],
        "additionalProperties": false,
        "description": "调用参数；未声明的字段会被拒绝。"
      },
      "output_schema": {
        "type": "object",
        "description": "",
        "properties": {
          "documentId": {
            "type": "string",
            "description": "已修改的画布 ID。"
          },
          "appliedRevision": {
            "type": "string",
            "description": "本次修改提交后的 revision。"
          },
          "revision": {
            "type": "string",
            "description": "本次操作保存的完整画布快照 revision；如期间有其他编辑，可能与 appliedRevision 不同。"
          },
          "savedLocally": {
            "type": "boolean",
            "description": "本次状态已保存本机；不代表云端同步完成。",
            "enum": [
              true
            ]
          },
          "edgeId": {
            "type": "string",
            "description": "新连线 ID。"
          }
        },
        "required": [
          "documentId",
          "appliedRevision",
          "revision",
          "savedLocally",
          "edgeId"
        ],
        "additionalProperties": false
      },
      "destructive": false,
      "open_world": false,
      "billable": false,
      "completion": "completed"
    }
  )
  register(
    {
      "name": "disconnect_nodes",
      "description": "删除明确指定的连线；使用 read_state 返回的原始连线 ID。 写入前调用 read_state 获取 documentId/revision；同一请求重试复用原幂等键及参数。",
      "access": "write",
      "idempotent": false,
      "input_schema": {
        "type": "object",
        "properties": {
          "idempotency_key": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "本次用户操作的唯一键，最多 128 字符。同一次请求重试必须原样复用键和全部参数；新操作才生成新键。"
          },
          "document_id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "目标画布 ID。编辑器写入须为最近 read_state 的 documentId；open_document 从 list_documents 选择 ID。"
          },
          "expected_revision": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "最近 read_state 返回的原样 revision；并发编辑会使旧值失效。"
          },
          "edge_ids": {
            "type": "array",
            "items": {
              "type": "string",
              "minLength": 1,
              "maxLength": 128,
              "description": "列表条目；ID 必须来自已读取或创建的对象。"
            },
            "minItems": 1,
            "maxItems": 100,
            "description": "read_state 返回的连线 ID 列表，1–100 项。"
          }
        },
        "required": [
          "idempotency_key",
          "document_id",
          "expected_revision",
          "edge_ids"
        ],
        "additionalProperties": false,
        "description": "调用参数；未声明的字段会被拒绝。"
      },
      "output_schema": {
        "type": "object",
        "description": "写入完成及本机保存结果。",
        "properties": {
          "documentId": {
            "type": "string",
            "description": "已修改的画布 ID。"
          },
          "appliedRevision": {
            "type": "string",
            "description": "本次修改提交后的 revision。"
          },
          "revision": {
            "type": "string",
            "description": "本次操作保存的完整画布快照 revision；如期间有其他编辑，可能与 appliedRevision 不同。"
          },
          "savedLocally": {
            "type": "boolean",
            "description": "本次状态已保存本机；不代表云端同步完成。",
            "enum": [
              true
            ]
          }
        },
        "required": [
          "documentId",
          "appliedRevision",
          "revision",
          "savedLocally"
        ],
        "additionalProperties": false
      },
      "destructive": true,
      "open_world": false,
      "billable": false,
      "completion": "completed"
    }
  )
  register(
    {
      "name": "arrange_nodes",
      "description": "按工作流依赖自动排列指定节点；传入完整可见分组时会带上隐藏逻辑成员并按一个布局单元移动，保持组内相对位置；部分成员只单独移动，分组边界会同步重建。写入前调用 read_state 获取 documentId/revision；同一请求重试复用原幂等键及参数。",
      "access": "write",
      "idempotent": false,
      "input_schema": {
        "type": "object",
        "properties": {
          "idempotency_key": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "本次用户操作的唯一键，最多 128 字符。同一次请求重试必须原样复用键和全部参数；新操作才生成新键。"
          },
          "document_id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "目标画布 ID。编辑器写入须为最近 read_state 的 documentId；open_document 从 list_documents 选择 ID。"
          },
          "expected_revision": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "最近 read_state 返回的原样 revision；并发编辑会使旧值失效。"
          },
          "node_ids": {
            "type": "array",
            "items": {
              "type": "string",
              "minLength": 1,
              "maxLength": 128,
              "description": "列表条目；ID 必须来自已读取或创建的对象。"
            },
            "minItems": 1,
            "maxItems": 100,
            "description": "明确选择的节点 ID 列表，1–100 项，不能重复。"
          }
        },
        "required": [
          "idempotency_key",
          "document_id",
          "expected_revision",
          "node_ids"
        ],
        "additionalProperties": false,
        "description": "调用参数；未声明的字段会被拒绝。"
      },
      "output_schema": {
        "type": "object",
        "description": "写入完成及本机保存结果。",
        "properties": {
          "documentId": {
            "type": "string",
            "description": "已修改的画布 ID。"
          },
          "appliedRevision": {
            "type": "string",
            "description": "本次修改提交后的 revision。"
          },
          "revision": {
            "type": "string",
            "description": "本次操作保存的完整画布快照 revision；如期间有其他编辑，可能与 appliedRevision 不同。"
          },
          "savedLocally": {
            "type": "boolean",
            "description": "本次状态已保存本机；不代表云端同步完成。",
            "enum": [
              true
            ]
          }
        },
        "required": [
          "documentId",
          "appliedRevision",
          "revision",
          "savedLocally"
        ],
        "additionalProperties": false
      },
      "destructive": true,
      "open_world": false,
      "billable": false,
      "completion": "completed"
    }
  )
  register(
    {
      "name": "save_document",
      "description": "将当前画布保存到本机，不承诺云端同步成功。 写入前调用 read_state 获取 documentId/revision；同一请求重试复用原幂等键及参数。",
      "access": "write",
      "idempotent": false,
      "input_schema": {
        "type": "object",
        "properties": {
          "idempotency_key": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "本次用户操作的唯一键，最多 128 字符。同一次请求重试必须原样复用键和全部参数；新操作才生成新键。"
          },
          "document_id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "目标画布 ID。编辑器写入须为最近 read_state 的 documentId；open_document 从 list_documents 选择 ID。"
          },
          "expected_revision": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "最近 read_state 返回的原样 revision；并发编辑会使旧值失效。"
          }
        },
        "required": [
          "idempotency_key",
          "document_id",
          "expected_revision"
        ],
        "additionalProperties": false,
        "description": "调用参数；未声明的字段会被拒绝。"
      },
      "output_schema": {
        "type": "object",
        "description": "写入完成及本机保存结果。",
        "properties": {
          "documentId": {
            "type": "string",
            "description": "已修改的画布 ID。"
          },
          "appliedRevision": {
            "type": "string",
            "description": "本次修改提交后的 revision。"
          },
          "revision": {
            "type": "string",
            "description": "本次操作保存的完整画布快照 revision；如期间有其他编辑，可能与 appliedRevision 不同。"
          },
          "savedLocally": {
            "type": "boolean",
            "description": "本次状态已保存本机；不代表云端同步完成。",
            "enum": [
              true
            ]
          }
        },
        "required": [
          "documentId",
          "appliedRevision",
          "revision",
          "savedLocally"
        ],
        "additionalProperties": false
      },
      "destructive": false,
      "open_world": false,
      "billable": false,
      "completion": "completed"
    }
  )
  register(
    {
      "name": "list_models",
      "description": "读取应用已加载的图片/视频/音乐模型目录；使用 available=true 的模型 ID。音频模型仅返回协作工具可以提交的文字音乐模型；音色设计和参考音频 Cover 请在 Canvas 创作面板中配置。",
      "access": "read",
      "idempotent": true,
      "input_schema": {
        "type": "object",
        "properties": {
          "offset": {
            "type": "integer",
            "minimum": 0,
            "description": "分页起始索引，默认 0；使用上次返回的 nextOffset 继续读取。"
          },
          "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 100,
            "description": "每页最多条数，默认 50，范围 1–100。"
          }
        },
        "required": [],
        "additionalProperties": false,
        "description": "调用参数；未声明的字段会被拒绝。"
      },
      "output_schema": {
        "type": "object",
        "description": "",
        "properties": {
          "models": {
            "type": "array",
            "description": "应用当前加载的模型目录。空数组可能表示模型目录尚在加载。",
            "items": {
              "type": "object",
              "description": "",
              "properties": {
                "id": {
                  "type": "string",
                  "description": "调用生成时使用的模型 ID。",
                  "minLength": 1
                },
                "name": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "description": "模型显示名称；目录未提供时为 null。"
                },
                "type": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "description": "模型类型，通常为 image、video 或 audio；目录未提供时为 null。"
                },
                "available": {
                  "type": "boolean",
                  "description": "目录是否标记为可用；具体输入兼容性仍由提交时校验。"
                },
                "supportedInputModes": {
                  "type": "array",
                  "description": "目录声明的输入模式；未声明时为空数组。",
                  "items": {
                    "type": "string",
                    "description": "列表项。"
                  }
                },
                "supportedOperations": {
                  "type": "array",
                  "description": "目录声明的操作；未声明时为空数组。",
                  "items": {
                    "type": "string",
                    "description": "列表项。"
                  }
                },
                "maxInputImages": {
                  "type": [
                    "number",
                    "null"
                  ],
                  "description": "最多参考图片数；目录未声明时为 null。",
                  "minimum": 0
                },
                "parameters": {
                  "type": "object",
                  "description": "",
                  "properties": {
                    "image": {
                      "type": [
                        "object",
                        "null"
                      ],
                      "description": "",
                      "properties": {
                        "qualities": {
                          "type": "array",
                          "description": "",
                          "items": {
                            "type": "string",
                            "description": ""
                          }
                        },
                        "resolutions": {
                          "type": "array",
                          "description": "",
                          "items": {
                            "type": "string",
                            "description": ""
                          }
                        },
                        "sizes": {
                          "type": "array",
                          "description": "",
                          "items": {
                            "type": "string",
                            "description": ""
                          }
                        },
                        "aspectRatios": {
                          "type": "array",
                          "description": "",
                          "items": {
                            "type": "string",
                            "description": ""
                          }
                        },
                        "outputFormats": {
                          "type": "array",
                          "description": "模型声明的图片编码格式；未声明时为空数组。",
                          "items": {
                            "type": "string",
                            "description": ""
                          }
                        },
                        "resolutionSizes": {
                          "type": "object",
                          "additionalProperties": true,
                          "description": "分辨率层级到尺寸列表的映射。"
                        },
                        "maxCount": {
                          "type": "integer",
                          "description": "",
                          "minimum": 1
                        },
                        "defaults": {
                          "type": "object",
                          "description": "",
                          "properties": {
                            "quality": {
                              "type": "string",
                              "description": "从 list_models 的可用选项中选择。",
                              "minLength": 1,
                              "maxLength": 128
                            },
                            "resolution": {
                              "type": "string",
                              "description": "从 list_models 的可用选项中选择。",
                              "minLength": 1,
                              "maxLength": 128
                            },
                            "size": {
                              "type": "string",
                              "description": "从 list_models 的可用选项中选择。",
                              "minLength": 1,
                              "maxLength": 128
                            },
                            "count": {
                              "type": "integer",
                              "description": "生成张数，不得超出模型 maxCount。",
                              "minimum": 1,
                              "maximum": 1000
                            },
                            "aspectRatio": {
                              "type": "string",
                              "description": "从 list_models 的可用选项中选择。",
                              "minLength": 1,
                              "maxLength": 128
                            },
                            "outputFormat": {
                              "type": "string",
                              "description": "从 outputFormats 中选择编码格式。",
                              "minLength": 1,
                              "maxLength": 32
                            }
                          },
                          "required": [],
                          "additionalProperties": false
                        }
                      },
                      "required": [
                        "qualities",
                        "resolutions",
                        "sizes",
                        "aspectRatios",
                        "outputFormats",
                        "resolutionSizes",
                        "maxCount",
                        "defaults"
                      ],
                      "additionalProperties": false
                    },
                    "video": {
                      "type": [
                        "object",
                        "null"
                      ],
                      "description": "",
                      "properties": {
                        "durations": {
                          "type": "array",
                          "description": "",
                          "items": {
                            "type": "number"
                          }
                        },
                        "resolutions": {
                          "type": "array",
                          "description": "",
                          "items": {
                            "type": "string",
                            "description": ""
                          }
                        },
                        "sizes": {
                          "type": "array",
                          "description": "",
                          "items": {
                            "type": "string",
                            "description": ""
                          }
                        },
                        "aspectRatios": {
                          "type": "array",
                          "description": "",
                          "items": {
                            "type": "string",
                            "description": ""
                          }
                        },
                        "defaults": {
                          "type": "object",
                          "description": "",
                          "properties": {
                            "resolution": {
                              "type": "string",
                              "description": "从 list_models 的可用选项中选择。",
                              "minLength": 1,
                              "maxLength": 128
                            },
                            "size": {
                              "type": "string",
                              "description": "从 list_models 的可用选项中选择。",
                              "minLength": 1,
                              "maxLength": 128
                            },
                            "aspect_ratio": {
                              "type": "string",
                              "description": "从 list_models 的可用选项中选择。",
                              "minLength": 1,
                              "maxLength": 128
                            },
                            "duration": {
                              "type": "number",
                              "minimum": 0.01,
                              "description": "视频时长（秒），须为模型公布的时长。"
                            },
                            "generate_audio": {
                              "type": "boolean"
                            }
                          },
                          "required": [],
                          "additionalProperties": false
                        }
                      },
                      "required": [
                        "durations",
                        "resolutions",
                        "sizes",
                        "aspectRatios",
                        "defaults"
                      ],
                      "additionalProperties": false
                    },
                    "music": {
                      "type": [
                        "object",
                        "null"
                      ],
                      "description": "音乐模型可选的模式、输出格式和时长；未声明时为空数组。",
                      "properties": {
                        "audioModes": {
                          "type": "array",
                          "items": {
                            "type": "string"
                          }
                        },
                        "outputFormats": {
                          "type": "array",
                          "items": {
                            "type": "string"
                          }
                        },
                        "durations": {
                          "type": "array",
                          "items": {
                            "type": "number"
                          }
                        },
                        "defaults": {
                          "type": "object",
                          "properties": {
                            "audio_mode": {
                              "type": "string"
                            },
                            "output_format": {
                              "type": "string"
                            },
                            "duration": {
                              "type": "number",
                              "minimum": 0.01
                            },
                            "lyrics_optimizer": {
                              "type": "boolean"
                            }
                          },
                          "required": [],
                          "additionalProperties": false
                        },
                        "supportsLyricsOptimizer": {
                          "type": "boolean",
                          "description": "模型能力契约是否明确支持歌词自动优化。"
                        }
                      },
                      "required": [
                        "audioModes",
                        "outputFormats",
                        "durations",
                        "defaults",
                        "supportsLyricsOptimizer"
                      ],
                      "additionalProperties": false
                    }
                  },
                  "required": [
                    "image",
                    "video",
                    "music"
                  ],
                  "additionalProperties": false
                }
              },
              "required": [
                "id",
                "name",
                "type",
                "available",
                "supportedInputModes",
                "supportedOperations",
                "maxInputImages",
                "parameters"
              ],
              "additionalProperties": false
            }
          },
          "nextOffset": {
            "type": [
              "integer",
              "null"
            ],
            "description": "下一页起始位置；null 表示没有下一页。",
            "minimum": 0
          }
        },
        "required": [
          "models",
          "nextOffset"
        ],
        "additionalProperties": false
      },
      "destructive": false,
      "open_world": false,
      "billable": false,
      "completion": "completed"
    }
  )
  register(
    {
      "name": "submit_generation",
      "description": "使用提示词节点明确选择的模型提交图片、视频或音乐生成，可能产生模型费用。仅返回任务已接受，不等待完成；随后用 read_tasks 查询，结果仍由应用保存与恢复。超时后先查询任务，勿使用新幂等键重复提交。 写入前调用 read_state 获取 documentId/revision；同一请求重试复用原幂等键及参数。",
      "access": "write",
      "idempotent": false,
      "input_schema": {
        "type": "object",
        "properties": {
          "idempotency_key": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "本次用户操作的唯一键，最多 128 字符。同一次请求重试必须原样复用键和全部参数；新操作才生成新键。"
          },
          "document_id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "目标画布 ID。编辑器写入须为最近 read_state 的 documentId；open_document 从 list_documents 选择 ID。"
          },
          "expected_revision": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "最近 read_state 返回的原样 revision；并发编辑会使旧值失效。"
          },
          "node_id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "已有节点 ID，来自 read_state、read_node 或创建结果。"
          }
        },
        "required": [
          "idempotency_key",
          "document_id",
          "expected_revision",
          "node_id"
        ],
        "additionalProperties": false,
        "description": "调用参数；未声明的字段会被拒绝。"
      },
      "output_schema": {
        "type": "object",
        "description": "",
        "properties": {
          "documentId": {
            "type": "string",
            "description": "已修改的画布 ID。"
          },
          "appliedRevision": {
            "type": "string",
            "description": "本次修改提交后的 revision。"
          },
          "revision": {
            "type": "string",
            "description": "本次操作保存的完整画布快照 revision；如期间有其他编辑，可能与 appliedRevision 不同。"
          },
          "savedLocally": {
            "type": "boolean",
            "description": "本次状态已保存本机；不代表云端同步完成。",
            "enum": [
              true
            ]
          },
          "nodeId": {
            "type": "string",
            "description": "接受生成的提示词节点 ID。"
          },
          "accepted": {
            "type": "boolean",
            "description": "应用已接受任务并开始自己的提交、轮询与恢复流程。",
            "enum": [
              true
            ]
          },
          "completed": {
            "type": "boolean",
            "description": "本次调用不等待生成完成；必须通过 read_tasks 查询。",
            "enum": [
              false
            ]
          }
        },
        "required": [
          "documentId",
          "appliedRevision",
          "revision",
          "savedLocally",
          "nodeId",
          "accepted",
          "completed"
        ],
        "additionalProperties": false
      },
      "destructive": false,
      "open_world": true,
      "billable": true,
      "completion": "accepted"
    }
  )
  register(
    {
      "name": "read_tasks",
      "description": "查询当前画布的生成状态、任务/提交 ID、错误和结果节点 ID。 completed 表示任务结束，以 resultNodeIds 定位结果；queued/running 时稍后查询，paused 不代表取消。",
      "access": "read",
      "idempotent": true,
      "input_schema": {
        "type": "object",
        "properties": {
          "offset": {
            "type": "integer",
            "minimum": 0,
            "description": "分页起始索引，默认 0；使用上次返回的 nextOffset 继续读取。"
          },
          "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 100,
            "description": "每页最多条数，默认 50，范围 1–100。"
          }
        },
        "required": [],
        "additionalProperties": false,
        "description": "调用参数；未声明的字段会被拒绝。"
      },
      "output_schema": {
        "type": "object",
        "description": "",
        "properties": {
          "documentId": {
            "type": "string",
            "description": "任务所属的当前画布 ID。"
          },
          "revision": {
            "type": "string",
            "description": "查询时的画布版本。"
          },
          "tasks": {
            "type": "array",
            "description": "当前页曾提交或保留任务 ID 的提示词任务。",
            "items": {
              "type": "object",
              "description": "",
              "properties": {
                "nodeId": {
                  "type": "string",
                  "description": "提示词节点 ID。"
                },
                "mediaType": {
                  "type": "string",
                  "description": "生成媒体类型。",
                  "enum": [
                    "image",
                    "video",
                    "audio"
                  ]
                },
                "modelId": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "description": "模型 ID；未设置为 null。"
                },
                "imageSettings": {
                  "type": [
                    "object",
                    "null"
                  ],
                  "description": "本次图片生成使用的设置；未设置时为 null。",
                  "properties": {
                    "quality": {
                      "type": "string"
                    },
                    "resolution": {
                      "type": "string"
                    },
                    "size": {
                      "type": "string"
                    },
                    "aspectRatio": {
                      "type": "string"
                    },
                    "count": {
                      "type": "integer",
                      "minimum": 1
                    },
                    "outputFormat": {
                      "type": "string"
                    }
                  },
                  "required": [],
                  "additionalProperties": false
                },
                "videoSettings": {
                  "type": [
                    "object",
                    "null"
                  ],
                  "description": "本次视频生成使用的设置；未设置时为 null。",
                  "properties": {
                    "duration": {
                      "type": "number",
                      "minimum": 0.01
                    },
                    "resolution": {
                      "type": "string"
                    },
                    "size": {
                      "type": "string"
                    },
                    "aspect_ratio": {
                      "type": "string"
                    },
                    "generate_audio": {
                      "type": "boolean"
                    }
                  },
                  "required": [],
                  "additionalProperties": false
                },
                "musicSettings": {
                  "type": [
                    "object",
                    "null"
                  ],
                  "description": "音乐生成设置；未设置时为 null。",
                  "properties": {
                    "audio_mode": {
                      "type": "string"
                    },
                    "output_format": {
                      "type": "string"
                    },
                    "duration": {
                      "type": "number",
                      "minimum": 0.01
                    },
                    "lyrics_optimizer": {
                      "type": "boolean"
                    }
                  },
                  "required": [],
                  "additionalProperties": false
                },
                "musicLyrics": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "description": "独立保存的歌词；未设置时为 null。"
                },
                "status": {
                  "type": "string",
                  "description": "任务状态；idle 尚未提交，queued/running 进行中，completed 已完成，failed 失败。",
                  "enum": [
                    "idle",
                    "queued",
                    "running",
                    "completed",
                    "failed"
                  ]
                },
                "taskId": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "description": "平台任务 ID；尚未取得时为 null。"
                },
                "submissionId": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "description": "应用持久化的生成提交 ID；没有时为 null。"
                },
                "paused": {
                  "type": "boolean",
                  "description": "任务查询是否暂停；不代表服务端任务取消。"
                },
                "error": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "description": "最多 2000 字符的错误摘要，URL 已省略；无错误为 null。",
                  "maxLength": 2000
                },
                "resultNodeIds": {
                  "type": "array",
                  "description": "仅本次已完成任务的结果节点 ID；进行中/失败为 []，历史身份不明时也返回 []，不把旧结果当作本次结果。",
                  "items": {
                    "type": "string",
                    "description": "列表项。"
                  }
                },
                "batchId": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "description": "当前结果批次 ID；旧记录无法确认时为 null。"
                },
                "observedStatus": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "description": "最近平台确认的状态，cancel_requested 不等于已取消。"
                },
                "audioMode": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "enum": [
                    "music",
                    "voice_design",
                    "tts",
                    "recording",
                    null
                  ],
                  "description": "音频创作模式；旧音频节点默认为 music，其他媒体为 null。tts 仅标识历史只读记录，不支持创建、配置、提交、恢复或取消。"
                },
                "voicePreviewText": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "description": "音色设计的试听文本；未设置为 null。"
                },
                "voiceId": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "description": "音色设计生成的 voice_id；未生成为 null。"
                },
                "audioTaskType": {
                  "type": [
                    "string",
                    "null"
                  ],
                  "enum": [
                    "music",
                    "voice_design",
                    "tts",
                    null
                  ],
                  "description": "持久化音频结果的任务类型；不依赖当前选中的创作模式。tts 仅用于读取历史音频，不提供生成接口。"
                }
              },
              "required": [
                "nodeId",
                "mediaType",
                "modelId",
                "imageSettings",
                "videoSettings",
                "musicSettings",
                "musicLyrics",
                "status",
                "taskId",
                "submissionId",
                "paused",
                "error",
                "resultNodeIds",
                "batchId",
                "observedStatus",
                "audioMode",
                "voicePreviewText",
                "voiceId",
                "audioTaskType"
              ],
              "additionalProperties": false
            }
          },
          "nextOffset": {
            "type": [
              "integer",
              "null"
            ],
            "description": "下一页起始位置；null 表示没有下一页。",
            "minimum": 0
          }
        },
        "required": [
          "documentId",
          "revision",
          "tasks",
          "nextOffset"
        ],
        "additionalProperties": false
      },
      "destructive": false,
      "open_world": false,
      "billable": false,
      "completion": "completed"
    }
  )
  register(
    {
      "name": "configure_generation",
      "description": "配置提示词的模型和图片/视频/音乐参数，校验当前模型限制，不静默替换不支持的值。歌词通过 music_settings.lyrics 单独保存；lyrics_optimizer 仅在模型目录明确声明支持时可传。调用后 read_node 核对最终设置；此操作不生成。",
      "access": "write",
      "idempotent": false,
      "input_schema": {
        "type": "object",
        "description": "",
        "properties": {
          "idempotency_key": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "本次用户操作的唯一键，最多 128 字符。同一次请求重试必须原样复用键和全部参数；新操作才生成新键。"
          },
          "document_id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "目标画布 ID。编辑器写入须为最近 read_state 的 documentId；open_document 从 list_documents 选择 ID。"
          },
          "expected_revision": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "最近 read_state 返回的原样 revision；并发编辑会使旧值失效。"
          },
          "node_id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "已有节点 ID，来自 read_state、read_node 或创建结果。"
          },
          "model_id": {
            "type": "string",
            "description": "",
            "minLength": 1,
            "maxLength": 128
          },
          "image_settings": {
            "type": "object",
            "description": "",
            "properties": {
              "quality": {
                "type": "string",
                "description": "从 list_models 的可用选项中选择。",
                "minLength": 1,
                "maxLength": 128
              },
              "resolution": {
                "type": "string",
                "description": "从 list_models 的可用选项中选择。",
                "minLength": 1,
                "maxLength": 128
              },
              "size": {
                "type": "string",
                "description": "从 list_models 的可用选项中选择。",
                "minLength": 1,
                "maxLength": 128
              },
              "aspect_ratio": {
                "type": "string",
                "description": "从 list_models 的可用选项中选择。",
                "minLength": 1,
                "maxLength": 128
              },
              "output_format": {
                "type": "string",
                "description": "从 list_models 的 outputFormats 中选择编码格式。",
                "minLength": 1,
                "maxLength": 32
              },
              "count": {
                "type": "integer",
                "description": "生成张数，不得超出模型 maxCount。",
                "minimum": 1,
                "maximum": 1000
              }
            },
            "required": [],
            "additionalProperties": false
          },
          "video_settings": {
            "type": "object",
            "description": "",
            "properties": {
              "resolution": {
                "type": "string",
                "description": "从 list_models 的可用选项中选择。",
                "minLength": 1,
                "maxLength": 128
              },
              "size": {
                "type": "string",
                "description": "从 list_models 的可用选项中选择。",
                "minLength": 1,
                "maxLength": 128
              },
              "aspect_ratio": {
                "type": "string",
                "description": "从 list_models 的可用选项中选择。",
                "minLength": 1,
                "maxLength": 128
              },
              "duration": {
                "type": "number",
                "minimum": 0.01,
                "description": "视频时长（秒），须为模型公布的时长。"
              }
            },
            "required": [],
            "additionalProperties": false
          },
          "music_settings": {
            "type": "object",
            "description": "音乐模型参数；只能使用 list_models 返回的值。",
            "properties": {
              "audio_mode": {
                "type": "string",
                "minLength": 1,
                "maxLength": 32
              },
              "output_format": {
                "type": "string",
                "minLength": 1,
                "maxLength": 32
              },
              "duration": {
                "type": "number",
                "minimum": 0.01
              },
              "lyrics": {
                "type": "string",
                "maxLength": 20000
              },
              "lyrics_optimizer": {
                "type": "boolean"
              }
            },
            "required": [],
            "additionalProperties": false
          }
        },
        "required": [
          "idempotency_key",
          "document_id",
          "expected_revision",
          "node_id"
        ],
        "additionalProperties": false
      },
      "output_schema": {
        "type": "object",
        "description": "",
        "properties": {
          "documentId": {
            "type": "string",
            "description": "已修改的画布 ID。"
          },
          "appliedRevision": {
            "type": "string",
            "description": "本次修改提交后的 revision。"
          },
          "revision": {
            "type": "string",
            "description": "本次操作保存的完整画布快照 revision；如期间有其他编辑，可能与 appliedRevision 不同。"
          },
          "savedLocally": {
            "type": "boolean",
            "description": "本次状态已保存本机；不代表云端同步完成。",
            "enum": [
              true
            ]
          }
        },
        "required": [
          "documentId",
          "appliedRevision",
          "revision",
          "savedLocally"
        ],
        "additionalProperties": false
      },
      "destructive": false,
      "open_world": false,
      "billable": false,
      "completion": "completed"
    }
  )
  register(
    {
      "name": "upload_image_chunk",
      "description": "分块暂存 PNG/JPEG/WebP 素材，最多 8 MiB，每块原始字节不超过 192 KiB。upload_id 使用新的字母/数字/下划线/连字符 ID；首次 offset=0，续块使用 nextOffset。每块使用独立幂等键；同一块重试原样复用。暂存最多 4 份、10 分钟过期，不修改画布。",
      "access": "write",
      "idempotent": false,
      "input_schema": {
        "type": "object",
        "description": "",
        "properties": {
          "idempotency_key": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "本次用户操作的唯一键，最多 128 字符。同一次请求重试必须原样复用键和全部参数；新操作才生成新键。"
          },
          "document_id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "目标画布 ID。编辑器写入须为最近 read_state 的 documentId；open_document 从 list_documents 选择 ID。"
          },
          "expected_revision": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "最近 read_state 返回的原样 revision；并发编辑会使旧值失效。"
          },
          "upload_id": {
            "type": "string",
            "description": "",
            "minLength": 1,
            "maxLength": 128
          },
          "mime_type": {
            "type": "string",
            "description": "",
            "enum": [
              "image/png",
              "image/jpeg",
              "image/webp"
            ]
          },
          "byte_offset": {
            "type": "integer",
            "description": "",
            "minimum": 0,
            "maximum": 8388608
          },
          "data_base64": {
            "type": "string",
            "description": "",
            "minLength": 4,
            "maxLength": 262144
          }
        },
        "required": [
          "idempotency_key",
          "document_id",
          "expected_revision",
          "upload_id",
          "mime_type",
          "byte_offset",
          "data_base64"
        ],
        "additionalProperties": false
      },
      "output_schema": {
        "type": "object",
        "description": "",
        "properties": {
          "uploadId": {
            "type": "string",
            "description": ""
          },
          "nextOffset": {
            "type": "integer",
            "description": "",
            "minimum": 1
          },
          "expiresInSeconds": {
            "type": "integer",
            "description": ""
          }
        },
        "required": [
          "uploadId",
          "nextOffset",
          "expiresInSeconds"
        ],
        "additionalProperties": false
      },
      "destructive": false,
      "open_world": false,
      "billable": false,
      "completion": "completed"
    }
  )
  register(
    {
      "name": "import_image",
      "description": "将已完整上传的素材解码为画布图片节点并本机保存。只接受 upload_id，不接受 URL 或本机路径。完成后可 connect_nodes 用作参考图。",
      "access": "write",
      "idempotent": false,
      "input_schema": {
        "type": "object",
        "description": "",
        "properties": {
          "idempotency_key": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "本次用户操作的唯一键，最多 128 字符。同一次请求重试必须原样复用键和全部参数；新操作才生成新键。"
          },
          "document_id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "目标画布 ID。编辑器写入须为最近 read_state 的 documentId；open_document 从 list_documents 选择 ID。"
          },
          "expected_revision": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "最近 read_state 返回的原样 revision；并发编辑会使旧值失效。"
          },
          "upload_id": {
            "type": "string",
            "description": "",
            "minLength": 1,
            "maxLength": 128
          },
          "title": {
            "type": "string",
            "description": "",
            "minLength": 1,
            "maxLength": 200
          },
          "x": {
            "type": "number",
            "minimum": -100000,
            "maximum": 100000
          },
          "y": {
            "type": "number",
            "minimum": -100000,
            "maximum": 100000
          }
        },
        "required": [
          "idempotency_key",
          "document_id",
          "expected_revision",
          "upload_id",
          "title"
        ],
        "additionalProperties": false
      },
      "output_schema": {
        "type": "object",
        "description": "",
        "properties": {
          "documentId": {
            "type": "string",
            "description": "已修改的画布 ID。"
          },
          "appliedRevision": {
            "type": "string",
            "description": "本次修改提交后的 revision。"
          },
          "revision": {
            "type": "string",
            "description": "本次操作保存的完整画布快照 revision；如期间有其他编辑，可能与 appliedRevision 不同。"
          },
          "savedLocally": {
            "type": "boolean",
            "description": "本次状态已保存本机；不代表云端同步完成。",
            "enum": [
              true
            ]
          },
          "nodeId": {
            "type": "string",
            "description": ""
          }
        },
        "required": [
          "documentId",
          "appliedRevision",
          "revision",
          "savedLocally",
          "nodeId"
        ],
        "additionalProperties": false
      },
      "destructive": false,
      "open_world": false,
      "billable": false,
      "completion": "completed"
    }
  )
  register(
    {
      "name": "read_media",
      "description": "读取画布节点的实际媒体内容，用于查看或导出；最大 64 MiB，以每块最多 192 KiB 的 base64 返回，不暴露媒体 URL、凭据或本机路径。首块 byte_offset=0；续块同时传 nextOffset 和首块 hash。解码后按顺序拼接并校验 SHA-256；发生 MEDIA_CHANGED 从头读取。",
      "access": "read",
      "idempotent": true,
      "input_schema": {
        "type": "object",
        "description": "",
        "properties": {
          "node_id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "已有节点 ID，来自 read_state、read_node 或创建结果。"
          },
          "byte_offset": {
            "type": "integer",
            "description": "",
            "minimum": 0,
            "maximum": 67108864
          },
          "expected_hash": {
            "type": "string",
            "description": "",
            "minLength": 64,
            "maxLength": 64
          }
        },
        "required": [
          "node_id"
        ],
        "additionalProperties": false
      },
      "output_schema": {
        "type": "object",
        "description": "",
        "properties": {
          "documentId": {
            "type": "string",
            "description": ""
          },
          "nodeId": {
            "type": "string",
            "description": ""
          },
          "mimeType": {
            "type": "string",
            "description": ""
          },
          "totalBytes": {
            "type": "integer",
            "description": "",
            "minimum": 1,
            "maximum": 67108864
          },
          "hash": {
            "type": "string",
            "description": "",
            "minLength": 64,
            "maxLength": 64
          },
          "byteOffset": {
            "type": "integer",
            "description": "",
            "minimum": 0
          },
          "nextOffset": {
            "type": [
              "integer",
              "null"
            ],
            "minimum": 0
          },
          "dataBase64": {
            "type": "string",
            "description": "",
            "maxLength": 262144
          }
        },
        "required": [
          "documentId",
          "nodeId",
          "mimeType",
          "totalBytes",
          "hash",
          "byteOffset",
          "nextOffset",
          "dataBase64"
        ],
        "additionalProperties": false
      },
      "destructive": false,
      "open_world": false,
      "billable": false,
      "completion": "completed"
    }
  )
  register(
    {
      "name": "resume_generation",
      "description": "恢复原任务的查询/原冻结提交，保留原 taskId 和提交幂等键；不能用于重新生成已完成或失败任务。返回 accepted 仅代表开始恢复，请 read_tasks 继续确认。",
      "access": "write",
      "idempotent": false,
      "input_schema": {
        "type": "object",
        "description": "",
        "properties": {
          "idempotency_key": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "本次用户操作的唯一键，最多 128 字符。同一次请求重试必须原样复用键和全部参数；新操作才生成新键。"
          },
          "document_id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "目标画布 ID。编辑器写入须为最近 read_state 的 documentId；open_document 从 list_documents 选择 ID。"
          },
          "expected_revision": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "最近 read_state 返回的原样 revision；并发编辑会使旧值失效。"
          },
          "node_id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "已有节点 ID，来自 read_state、read_node 或创建结果。"
          }
        },
        "required": [
          "idempotency_key",
          "document_id",
          "expected_revision",
          "node_id"
        ],
        "additionalProperties": false
      },
      "output_schema": {
        "type": "object",
        "description": "",
        "properties": {
          "documentId": {
            "type": "string",
            "description": "已修改的画布 ID。"
          },
          "appliedRevision": {
            "type": "string",
            "description": "本次修改提交后的 revision。"
          },
          "revision": {
            "type": "string",
            "description": "本次操作保存的完整画布快照 revision；如期间有其他编辑，可能与 appliedRevision 不同。"
          },
          "savedLocally": {
            "type": "boolean",
            "description": "本次状态已保存本机；不代表云端同步完成。",
            "enum": [
              true
            ]
          },
          "nodeId": {
            "type": "string",
            "description": ""
          },
          "accepted": {
            "type": "boolean",
            "enum": [
              true
            ]
          },
          "completed": {
            "type": "boolean",
            "enum": [
              false
            ]
          }
        },
        "required": [
          "documentId",
          "appliedRevision",
          "revision",
          "savedLocally",
          "nodeId",
          "accepted",
          "completed"
        ],
        "additionalProperties": false
      },
      "destructive": false,
      "open_world": false,
      "billable": false,
      "completion": "accepted"
    }
  )
  register(
    {
      "name": "cancel_generation",
      "description": "请求取消原视频、音乐或音色设计任务，必须已有 taskId；图片任务目前不支持取消。cancellationRequested 仅代表请求，只有 cancelled=true 才是平台确认取消。请求后继续 read_tasks；不承诺退费或撤回已经完成的生成。",
      "access": "write",
      "idempotent": false,
      "input_schema": {
        "type": "object",
        "description": "",
        "properties": {
          "idempotency_key": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "本次用户操作的唯一键，最多 128 字符。同一次请求重试必须原样复用键和全部参数；新操作才生成新键。"
          },
          "document_id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "目标画布 ID。编辑器写入须为最近 read_state 的 documentId；open_document 从 list_documents 选择 ID。"
          },
          "expected_revision": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "最近 read_state 返回的原样 revision；并发编辑会使旧值失效。"
          },
          "node_id": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128,
            "description": "已有节点 ID，来自 read_state、read_node 或创建结果。"
          }
        },
        "required": [
          "idempotency_key",
          "document_id",
          "expected_revision",
          "node_id"
        ],
        "additionalProperties": false
      },
      "output_schema": {
        "type": "object",
        "description": "",
        "properties": {
          "documentId": {
            "type": "string",
            "description": "已修改的画布 ID。"
          },
          "appliedRevision": {
            "type": "string",
            "description": "本次修改提交后的 revision。"
          },
          "revision": {
            "type": "string",
            "description": "本次操作保存的完整画布快照 revision；如期间有其他编辑，可能与 appliedRevision 不同。"
          },
          "savedLocally": {
            "type": "boolean",
            "description": "本次状态已保存本机；不代表云端同步完成。",
            "enum": [
              true
            ]
          },
          "nodeId": {
            "type": "string",
            "description": ""
          },
          "cancellationRequested": {
            "type": "boolean",
            "enum": [
              true
            ]
          },
          "cancelled": {
            "type": "boolean"
          },
          "status": {
            "type": "string",
            "description": ""
          }
        },
        "required": [
          "documentId",
          "appliedRevision",
          "revision",
          "savedLocally",
          "nodeId",
          "cancellationRequested",
          "cancelled",
          "status"
        ],
        "additionalProperties": false
      },
      "destructive": false,
      "open_world": false,
      "billable": false,
      "completion": "accepted"
    }
  )
  for (const name of Object.keys(handlers || {})) {
    if (!registeredNames.has(name)) {
      cleanup()
      throw new Error('Unknown canvas agent capability handler: ' + name)
    }
  }
  return disposers
}

/** Collect the declarations by executing the same registration implementation. */
export function getAgentCapabilities() {
  const collected = []
  registerAgentTools({ register(declaration) {
    collected.push(structuredClone(declaration))
    return () => {}
  } })
  return collected
}

export function capability(name) {
  const declaration = getAgentCapabilities().find((item) => item.name === name)
  if (!declaration) throw new Error(`Unknown canvas agent capability: ${name}`)
  return declaration
}

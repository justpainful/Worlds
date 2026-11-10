package worlds.android

import android.app.Activity
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.os.Bundle
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.print.PageRange
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintDocumentInfo
import android.print.PrintManager
import android.print.pdf.PrintedPdfDocument
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import worlds.content.ContentBlock
import java.io.FileOutputStream
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.max

/**
 * Standard Android PrintDocumentAdapter generating A4-compatible formatted PDF documents.
 */
internal class DocumentPrintAdapter(
    private val context: Context,
    private val documentTitle: String,
    private val blocks: List<ContentBlock>
) : PrintDocumentAdapter() {

    private var pdfDocument: PrintedPdfDocument? = null
    private var totalPages = 1
    private var printAttributes: PrintAttributes? = null

    override fun onLayout(
        oldAttributes: PrintAttributes?,
        newAttributes: PrintAttributes,
        cancellationSignal: CancellationSignal?,
        callback: LayoutResultCallback,
        extras: Bundle?
    ) {
        if (cancellationSignal?.isCanceled == true) {
            callback.onLayoutCancelled()
            return
        }

        printAttributes = newAttributes
        val mediaSize = newAttributes.mediaSize ?: PrintAttributes.MediaSize.ISO_A4
        val pageHeight = (mediaSize.heightMils * 72 / 1000).coerceAtLeast(842)
        val contentHeightPerPage = pageHeight - 160 // Top and bottom margins + header/footer

        // Estimate pages based on total text length
        val totalChars = blocks.sumOf { previewBlock(it.content).text.length }
        totalPages = max(1, (totalChars / 1800) + 1)

        val info = PrintDocumentInfo.Builder(documentTitle.ifBlank { "Worlds Document" })
            .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
            .setPageCount(totalPages)
            .build()

        callback.onLayoutFinished(info, true)
    }

    override fun onWrite(
        pages: Array<out PageRange>?,
        destination: ParcelFileDescriptor,
        cancellationSignal: CancellationSignal?,
        callback: WriteResultCallback
    ) {
        val attributes = printAttributes ?: run {
            callback.onWriteFailed("Print attributes not initialized")
            return
        }

        val pdf = PrintedPdfDocument(context, attributes)
        pdfDocument = pdf

        val titlePaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(32, 32, 35)
            textSize = 22f
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        }
        val headerPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(120, 120, 128)
            textSize = 10f
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.NORMAL)
        }
        val bodyPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(40, 40, 45)
            textSize = 13f
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.NORMAL)
        }
        val linePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.rgb(220, 220, 225)
            strokeWidth = 1f
        }

        val dateStr = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(Date())

        try {
            val marginH = 54f
            val mediaSize = attributes.mediaSize ?: PrintAttributes.MediaSize.ISO_A4
            val pageWidth = (mediaSize.widthMils * 72 / 1000).coerceAtLeast(595)
            val pageHeight = (mediaSize.heightMils * 72 / 1000).coerceAtLeast(842)
            val printWidth = (pageWidth - marginH * 2).toInt()

            var blockIndex = 0
            for (p in 0 until totalPages) {
                if (cancellationSignal?.isCanceled == true) {
                    callback.onWriteCancelled()
                    return
                }

                val page = pdf.startPage(p)
                val canvas = page.canvas

                // Running header
                canvas.drawText(documentTitle.ifBlank { "Worlds Document" }, marginH, 40f, headerPaint)
                canvas.drawText(dateStr, pageWidth - marginH - headerPaint.measureText(dateStr), 40f, headerPaint)
                canvas.drawLine(marginH, 48f, pageWidth - marginH, 48f, linePaint)

                // Page title on page 0
                var currentY = 70f
                if (p == 0) {
                    canvas.drawText(documentTitle.ifBlank { "Untitled" }, marginH, currentY + 16f, titlePaint)
                    currentY += 40f
                }

                // Render blocks fitting on this page
                while (blockIndex < blocks.size && currentY < pageHeight - 80f) {
                    val block = blocks[blockIndex]
                    val preview = previewBlock(block.content)
                    val text = preview.text.toString()

                    if (text.isNotBlank()) {
                        val layout = StaticLayout.Builder.obtain(text, 0, text.length, bodyPaint, printWidth)
                            .setAlignment(Layout.Alignment.ALIGN_NORMAL)
                            .setLineSpacing(4f, 1.15f)
                            .setIncludePad(false)
                            .build()

                        if (currentY + layout.height > pageHeight - 80f && currentY > 110f) {
                            // Defer to next page
                            break
                        }

                        canvas.save()
                        canvas.translate(marginH, currentY)
                        layout.draw(canvas)
                        canvas.restore()
                        currentY += layout.height + 14f
                    }
                    blockIndex++
                }

                // Running footer
                val footerText = "Worlds"
                val pageNumText = "Page ${p + 1} of $totalPages"
                canvas.drawLine(marginH, pageHeight - 44f, pageWidth - marginH, pageHeight - 44f, linePaint)
                canvas.drawText(footerText, marginH, pageHeight - 30f, headerPaint)
                canvas.drawText(pageNumText, pageWidth - marginH - headerPaint.measureText(pageNumText), pageHeight - 30f, headerPaint)

                pdf.finishPage(page)
            }

            FileOutputStream(destination.fileDescriptor).use { out ->
                pdf.writeTo(out)
            }
            callback.onWriteFinished(arrayOf(PageRange.ALL_PAGES))
        } catch (e: IOException) {
            callback.onWriteFailed(e.message)
        } finally {
            pdf.close()
            pdfDocument = null
        }
    }
}

/** Print utility invoked from activity. */
internal fun printWorldsDocument(activity: Activity, title: String, blocks: List<ContentBlock>) {
    val printManager = activity.getSystemService(Context.PRINT_SERVICE) as? PrintManager ?: return
    val jobName = "Worlds - ${title.ifBlank { "Document" }}"
    val adapter = DocumentPrintAdapter(activity, title, blocks)
    printManager.print(
        jobName,
        adapter,
        PrintAttributes.Builder()
            .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
            .setMinMargins(PrintAttributes.Margins(54, 54, 54, 54))
            .build()
    )
}
